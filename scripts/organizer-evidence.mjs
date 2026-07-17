// organizer-evidence.mjs
// Gathers a compact evidence packet per event so an LLM (sonnet subagent) can name the true
// organizer, and so we can VERIFY that judgment against real data (domain + contact-share signals)
// before writing events.organizer_company_id.
//
// Organizer is the only role that cannot be earned from post content — it is set solely via
// events.organizer_company_id (see resolve_company_event_roles). A wrong set mis-tags a whole
// company's contacts, so we require two independent signals to agree before auto-setting.
//
// For each event we emit:
//   name / location / country / start_date / slug
//   topCompanies : companies that have contacts in the event, with domain + contact share + company-page-post count
//   emailDomains : histogram of contact EMAIL domains actually seen in the event (the strongest "who is here" signal)
//   deterministic: best name-token / host-dominance candidate (mirrors suggest-organizers.mjs)
//
// Usage:
//   node scripts/organizer-evidence.mjs --scope=live --out=scripts/output/org-evidence-live.json
//   node scripts/organizer-evidence.mjs --scope=all  --out=scripts/output/org-evidence-all.json
//   node scripts/organizer-evidence.mjs --ids=<id1>,<id2>

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
(function loadEnv() {
  const p = join(__dirname, "../.env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://citrznhubxqvsfhjkssg.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const arg = (n, d) => { const h = process.argv.find(x => x.startsWith(`--${n}=`)); return h ? h.split("=").slice(1).join("=") : d; };

const STOPWORDS = new Set(["the","and","for","summit","expo","conference","conf","forum","show","public","sector","world","global","international","annual","event","events","fair","congress","convention","meeting","festival","week","days","live","tour","series","north","america","europe","asia","national","tech","technology","digital","online","virtual","2026","2025","2027"]);
const tokens = (name) => [...new Set((name||"").toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length>=3 && !STOPWORDS.has(t)))];
const domainOf = (email) => { const at = (email||"").lastIndexOf("@"); return at<0 ? null : email.slice(at+1).toLowerCase().trim(); };
const FREEMAIL = new Set(["gmail.com","yahoo.com","hotmail.com","outlook.com","icloud.com","aol.com","protonmail.com","gmx.com","live.com","me.com","msn.com","googlemail.com"]);

async function eventContactIds(eventId) {
  const ids = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await sb.from("contact_events").select("contact_id").eq("event_id", eventId).range(from, from + page - 1);
    if (error) throw error;
    for (const r of data) ids.push(r.contact_id);
    if (data.length < page) break;
    from += page;
  }
  return [...new Set(ids)];
}

async function companyByContacts(contactIds) {
  const comp = {};
  for (let i = 0; i < contactIds.length; i += 500) {
    const { data } = await sb.from("contacts").select("id,current_company_id").in("id", contactIds.slice(i, i + 500));
    for (const c of data || []) if (c.current_company_id) comp[c.current_company_id] = (comp[c.current_company_id] || 0) + 1;
  }
  return comp; // companyId -> contactCount
}

async function emailDomainHistogram(contactIds) {
  const hist = {};
  for (let i = 0; i < contactIds.length; i += 300) {
    const { data } = await sb.from("contact_emails").select("email,status").in("contact_id", contactIds.slice(i, i + 300));
    for (const r of data || []) {
      const d = domainOf(r.email);
      if (!d || FREEMAIL.has(d)) continue;
      hist[d] = (hist[d] || 0) + 1;
    }
  }
  return hist;
}

async function companyPagePosts(eventId) {
  const cnt = {};
  let from = 0; const page = 1000;
  for (;;) {
    const { data } = await sb.from("posts").select("company_id,post_type").eq("event_id", eventId).eq("author_type", "company").not("company_id", "is", null).range(from, from + page - 1);
    if (!data || data.length === 0) break;
    for (const p of data) { if ((p.post_type||"").includes("rejected")) continue; cnt[p.company_id] = (cnt[p.company_id]||0) + 1; }
    if (data.length < page) break;
    from += page;
  }
  return cnt;
}

async function companiesMeta(ids) {
  const out = {};
  const list = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < list.length; i += 300) {
    const { data } = await sb.from("companies").select("id,name,normalized_name,domain,website,linkedin_url").in("id", list.slice(i, i + 300));
    for (const c of data || []) out[c.id] = c;
  }
  return out;
}

function deterministic(ev, topCompanies) {
  const evTokens = tokens(ev.name);
  // token uniqueness across candidate companies
  const tokenHits = {};
  for (const t of evTokens) for (const c of topCompanies) { if (new RegExp(`\\b${t}\\b`).test(c.normalized_name || (c.name||"").toLowerCase())) tokenHits[t] = (tokenHits[t]||0)+1; }
  let best = null;
  for (const c of topCompanies) {
    const norm = c.normalized_name || (c.name||"").toLowerCase();
    const matched = evTokens.filter(t => new RegExp(`\\b${t}\\b`).test(norm)).sort((a,b)=>b.length-a.length);
    const mt = matched[0];
    const distinctive = mt && tokenHits[mt] === 1;
    if (distinctive) { best = { companyId: c.companyId, name: c.name, tier: "name-match", why: `event name shares distinctive token "${mt}"` }; break; }
    if (!best && ((c.companyPagePosts >= 1 && c.share >= 0.25) || c.share >= 0.5)) best = { companyId: c.companyId, name: c.name, tier: "dominance", why: `${c.companyPagePosts} company posts, ${Math.round(c.share*100)}% of contacts` };
  }
  return best;
}

async function main() {
  const out = arg("out", "scripts/output/org-evidence.json");
  const scope = arg("scope", "live");
  const idsArg = arg("ids");

  let q = sb.from("events").select("id,name,location,country,region,start_date,slug,is_active,is_whogoes_active,organizer_company_id,website").is("organizer_company_id", null);
  if (idsArg) q = sb.from("events").select("id,name,location,country,region,start_date,slug,is_active,is_whogoes_active,organizer_company_id,website").in("id", idsArg.split(","));
  else if (scope === "live") q = q.or("is_active.eq.true,is_whogoes_active.eq.true");
  const { data: events, error } = await q.limit(2000);
  if (error) { console.error(error.message); process.exit(1); }
  console.error(`Gathering evidence for ${events.length} events (scope=${scope})...`);

  const packets = [];
  let n = 0;
  for (const ev of events) {
    n++;
    const cids = await eventContactIds(ev.id);
    const total = cids.length;
    const comp = await companyByContacts(cids);
    const pagePosts = await companyPagePosts(ev.id);
    const meta = await companiesMeta([...Object.keys(comp), ...Object.keys(pagePosts)]);
    const hist = await emailDomainHistogram(cids);

    const topCompanies = Object.entries(comp)
      .map(([companyId, contacts]) => ({ companyId, name: meta[companyId]?.name, normalized_name: meta[companyId]?.normalized_name, domain: meta[companyId]?.domain, contacts, share: total ? contacts/total : 0, companyPagePosts: pagePosts[companyId] || 0 }))
      .sort((a,b)=>b.contacts-a.contacts).slice(0, 12);
    const emailDomains = Object.entries(hist).map(([domain,count])=>({domain,count})).sort((a,b)=>b.count-a.count).slice(0, 12);
    const det = deterministic(ev, topCompanies);

    packets.push({
      eventId: ev.id, name: ev.name, location: ev.location, country: ev.country, region: ev.region,
      start_date: ev.start_date, slug: ev.slug, website: ev.website,
      totalContacts: total, totalContactsWithEmail: Object.values(hist).reduce((a,b)=>a+b,0),
      topCompanies, emailDomains, deterministic: det,
    });
    if (n % 10 === 0) console.error(`  ${n}/${events.length}`);
  }

  const dir = join(__dirname, "..", dirname(out));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(__dirname, "..", out), JSON.stringify(packets, null, 2));
  console.error(`Wrote ${packets.length} evidence packets -> ${out}`);
}
main();
