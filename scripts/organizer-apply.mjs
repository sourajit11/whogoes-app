// organizer-apply.mjs
// Takes the LLM organizer judgments (from sonnet subagents) + the evidence packets, VERIFIES each
// against real data, and only writes events.organizer_company_id when two independent signals agree.
// Everything uncertain goes to a human-review queue instead of being written.
//
// Confidence model (must be "fully confident" to auto-set):
//   NAME signal   : LLM names organizer AND it maps to a real company row (exact normalized name,
//                   or the LLM explicitly picked one of the event's candidate companyIds).
//   DOMAIN signal : that company's domain (or the LLM-supplied official domain) appears among the
//                   event's contact EMAIL domains, OR the company holds a real contact share in the event.
//   AUTO-SET  when NAME and DOMAIN both hold and LLM confidence is high  -> organizer_confidence='confirmed'
//   AUTO-SET  when a strong deterministic name-match agrees with the LLM  -> organizer_confidence='high'
//   QUEUE     otherwise (organizer not in DB / one signal only / low confidence / conflict)
//
// Usage:
//   node scripts/organizer-apply.mjs --evidence=scripts/output/org-evidence-live.json \
//        --judgments=scripts/output/org-judgments-live.json --dry            # report only, no writes
//   node scripts/organizer-apply.mjs ... --apply                             # write confident ones + re-resolve

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
(function loadEnv() {
  const p = join(__dirname, "../.env.local");
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const arg = (n, d) => { const h = process.argv.find(x => x.startsWith(`--${n}=`)); return h ? h.split("=").slice(1).join("=") : d; };
const flag = (n) => process.argv.includes(`--${n}`);

const norm = (s) => (s||"").toLowerCase()
  .replace(/\b(inc|llc|ltd|limited|gmbh|corp|co|plc|ag|sa|group|holdings|the)\b/g, "")
  .replace(/[^a-z0-9]+/g, " ").trim();
const rootDomain = (d) => { if (!d) return null; d = d.toLowerCase().replace(/^www\./,"").replace(/^https?:\/\//,"").split("/")[0].trim(); return d || null; };

async function matchCompanyByName(name) {
  const n = norm(name);
  if (!n) return null;
  let { data } = await sb.from("companies").select("id,name,normalized_name,domain").eq("normalized_name", n).limit(3);
  if (data?.length === 1) return { ...data[0], how: "exact-norm" };
  if (data?.length > 1) return { ...data[0], how: "exact-norm-ambiguous", ambiguous: data.length };
  ({ data } = await sb.from("companies").select("id,name,normalized_name,domain").ilike("name", name).limit(3));
  if (data?.length === 1) return { ...data[0], how: "exact-raw" };
  return null;
}
async function matchCompanyByDomain(domain) {
  const d = rootDomain(domain);
  if (!d) return null;
  const { data } = await sb.from("companies").select("id,name,normalized_name,domain").eq("domain", d).limit(3);
  if (data?.length === 1) return { ...data[0], how: "domain" };
  if (data?.length > 1) return { ...data[0], how: "domain-ambiguous", ambiguous: data.length };
  return null;
}

async function main() {
  const evidence = JSON.parse(readFileSync(join(__dirname, "..", arg("evidence")), "utf8"));
  const judgments = JSON.parse(readFileSync(join(__dirname, "..", arg("judgments")), "utf8"));
  const evById = Object.fromEntries(evidence.map(e => [e.eventId, e]));
  const doApply = flag("apply");

  const autoset = [], queue = [];
  for (const j of judgments) {
    const ev = evById[j.eventId];
    if (!ev) { queue.push({ ...j, reason: "no evidence packet" }); continue; }

    // 1) Resolve to a company row. PREFER the row that attendees are actually linked to
    //    (a present topCompanies entry whose normalized name or domain matches the organizer), so
    //    contacts really flip to organizer. Fall back to a global name/domain lookup otherwise.
    let company = null, matchHow = null;
    const orgNorm = norm(j.organizerName);
    const orgDom = rootDomain(j.organizerDomain);
    if (j.matchesCandidateId) {
      const cand = ev.topCompanies.find(c => c.companyId === j.matchesCandidateId);
      if (cand) { company = { id: cand.companyId, name: cand.name, domain: cand.domain, normalized_name: cand.normalized_name }; matchHow = "llm-picked-candidate"; }
    }
    if (!company) {
      const cand = ev.topCompanies.find(c =>
        (orgNorm && norm(c.name) === orgNorm) || (orgDom && rootDomain(c.domain) === orgDom));
      if (cand) { company = { id: cand.companyId, name: cand.name, domain: cand.domain, normalized_name: cand.normalized_name }; matchHow = "present-candidate"; }
    }
    if (!company && j.organizerName) { const m = await matchCompanyByName(j.organizerName); if (m && !m.ambiguous) { company = m; matchHow = "name:" + m.how; } }
    if (!company && j.organizerDomain) { const m = await matchCompanyByDomain(j.organizerDomain); if (m && !m.ambiguous) { company = m; matchHow = "domain:" + m.how; } }

    if (!company) { queue.push({ event: ev.name, eventId: ev.eventId, proposed: j.organizerName, domain: j.organizerDomain, llmConf: j.confidence, reason: "organizer not found in companies table (or ambiguous)" }); continue; }

    // 2) CORROBORATION that this company is actually PRESENT in the event (the user's core signal):
    //    its domain appears in the event's contact EMAIL domains, or it holds real contact share / posts.
    const evDomains = new Map((ev.emailDomains||[]).map(d => [rootDomain(d.domain), d.count]));
    const compDomain = rootDomain(company.domain);
    const llmDomain = rootDomain(j.organizerDomain);
    const cand = ev.topCompanies.find(c => c.companyId === company.id);
    const emailDomainCount = (compDomain && evDomains.get(compDomain)) || (llmDomain && evDomains.get(llmDomain)) || 0;
    const domainInEmails = emailDomainCount >= 1;
    const hasContactShare = cand ? cand.share : 0;
    const companyPagePosts = cand?.companyPagePosts || 0;
    const detAgrees = ev.deterministic && ev.deterministic.companyId === company.id;

    // IDENTITY = I confidently named the organizer AND it resolves to a real company row.
    const highConf = (j.confidence === "high" || j.confidence === "confirmed");
    // PRESENCE = at least one independent signal that this company is really here (not just named).
    const present = domainInEmails || hasContactShare >= 0.15 || (companyPagePosts >= 1 && hasContactShare > 0) || detAgrees;

    const rec = {
      event: ev.name, eventId: ev.eventId,
      organizer: company.name, companyId: company.id, matchHow,
      llmConf: j.confidence, llmReason: j.reasoning,
      domainInEmails, emailDomainCount, contactShare: +(hasContactShare*100).toFixed(1),
      detAgrees, companyPagePosts,
    };

    // GATE: identity + presence both required. Domain-in-contacts -> confirmed; other presence -> high.
    if (highConf && present && domainInEmails) { rec.setConfidence = "confirmed"; autoset.push(rec); }
    else if (highConf && present) { rec.setConfidence = "high"; autoset.push(rec); }
    else {
      rec.reason = !highConf ? `low LLM confidence` : !company ? `organizer not in DB` : `named but not verifiably present (domainInEmails=${domainInEmails}, share=${rec.contactShare}%, pp=${companyPagePosts}) -> needs human check`;
      queue.push(rec);
    }
  }

  autoset.sort((a,b)=> (b.contactShare||0)-(a.contactShare||0));
  console.log(`\n=== AUTO-SET (fully confident): ${autoset.length} ===`);
  for (const r of autoset) console.log(`  [${r.setConfidence}] ${r.event}\n     -> ${r.organizer}  (${r.matchHow}; domainInEmails=${r.domainInEmails}, share=${r.contactShare}%, detAgrees=${r.detAgrees})`);
  console.log(`\n=== HUMAN-REVIEW QUEUE: ${queue.length} ===`);
  for (const r of queue) console.log(`  ${r.event}\n     proposed: ${r.organizer||r.proposed||"?"}  | ${r.reason}`);

  // write review CSV
  const csv = ["event,eventId,proposed_organizer,companyId,llm_confidence,domainInEmails,contactSharePct,detAgrees,reason"];
  for (const r of queue) csv.push([r.event, r.eventId, (r.organizer||r.proposed||""), (r.companyId||""), (r.llmConf||""), (r.domainInEmails||""), (r.contactShare||""), (r.detAgrees||""), (r.reason||"").replace(/,/g,";")].map(x=>`"${String(x).replace(/"/g,'""')}"`).join(","));
  const reviewPath = join(__dirname, "..", arg("review", "scripts/output/org-review-queue.csv"));
  writeFileSync(reviewPath, csv.join("\n"));
  console.log(`\nReview queue written -> ${arg("review", "scripts/output/org-review-queue.csv")}`);

  if (!doApply) { console.log("\n(dry run — pass --apply to write the AUTO-SET rows)"); return; }

  console.log(`\nApplying ${autoset.length} organizers...`);
  for (const r of autoset) {
    const { error: e1 } = await sb.from("events").update({ organizer_company_id: r.companyId, organizer_confidence: r.setConfidence }).eq("id", r.eventId);
    if (e1) { console.log(`  FAIL ${r.event}: ${e1.message}`); continue; }
    await sb.rpc("resolve_company_event_roles", { p_event_id: r.eventId, p_write: true });
    await sb.rpc("refresh_event_contact_facts", { p_event_id: r.eventId });
    await sb.rpc("refresh_event_facets", { p_event_id: r.eventId });
    const { count } = await sb.from("event_contact_facts").select("*", { count: "exact", head: true }).eq("event_id", r.eventId).eq("role", "organizer");
    console.log(`  OK  ${r.event} -> ${r.organizer}  (${count} contacts now organizer)`);
  }
}
main();
