// suggest-organizers.mjs
// Finds events whose organizer_company_id is not set and suggests the host company,
// then (on confirm) sets events.organizer_company_id and re-resolves roles.
//
// Organizer is the ONLY role that cannot be earned from post content: it is set solely
// via events.organizer_company_id (see resolve_company_event_roles). The old auto-suggest
// only matched the event NAME against company names, so branded events whose name differs
// from the host (Dreamforce -> Salesforce, Ignite -> Microsoft) never got a suggestion.
//
// This tool ranks candidates by three signals:
//   A  name-token match   company name shares a distinctive token with the event name (highest precision)
//   B  host dominance      company authored company-page posts AND holds a large share of the event's contacts
//   C  curated seed map    known event -> host aliases where the name does not match
//
// Usage:
//   node scripts/suggest-organizers.mjs                 # scan active null-organizer events
//   node scripts/suggest-organizers.mjs --all           # include non-active events too
//   node scripts/suggest-organizers.mjs --min=12        # min contacts for a dominance suggestion (default 8)
//   node scripts/suggest-organizers.mjs --limit=40      # cap rows printed (default 40)
//   node scripts/suggest-organizers.mjs --event=dreamforce-2026   # one event by slug or name
//   node scripts/suggest-organizers.mjs --set=<eventId>:<companyId>  # confirm + set organizer + re-resolve

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://citrznhubxqvsfhjkssg.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error("Missing SUPABASE_SERVICE_ROLE_KEY in app/.env.local"); process.exit(1); }
const sb = createClient(SUPABASE_URL, KEY);

const arg = (name, def) => {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

// Curated aliases for well-known events whose brand name does not contain the host company name.
// Match is a lowercase substring of the event name -> a lowercase substring of the company name.
const SEED_ALIASES = [
  { eventLike: "dreamforce", companyLike: "salesforce" },
  { eventLike: "ignite", companyLike: "microsoft" },
  { eventLike: "re:invent", companyLike: "amazon web services" },
  { eventLike: "reinvent", companyLike: "amazon web services" },
  { eventLike: "knowledge", companyLike: "servicenow" },
  { eventLike: "inbound", companyLike: "hubspot" },
];

// Words too generic to be a distinctive brand token (mirrors suggest_event_organizer in SQL).
const STOPWORDS = new Set([
  "the","and","for","summit","expo","conference","conf","forum","show","public","sector","world",
  "global","international","annual","event","events","fair","congress","convention","meeting",
  "festival","week","days","live","tour","series","north","america","europe","asia","national",
  "tech","technology","digital","online","virtual","2026","2025","2027",
]);

// Industry/geography words that are real tokens but too common to identify a host on their own.
// A match on one of these only counts if the company also dominates the crowd (Tier A2 -> B logic).
const GENERIC_WORDS = new Set([
  "water","energy","medical","security","restaurant","pharmacy","pharma","trailer","fashion","food",
  "retail","health","healthcare","finance","financial","marketing","sales","data","cloud","cyber",
  "manufacturing","industrial","construction","travel","hospitality","logistics","supply","chain",
  "california","texas","florida","london","paris","berlin","dubai","saudi","middle","east","west",
  "restaurant","beauty","legal","auto","automotive","energy","design","packaging","aerospace","defense",
]);

const tokens = (name) =>
  [...new Set((name || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t)))];

async function contactShare(eventId) {
  // company_id -> distinct contact count, via contact_events + contacts.current_company_id
  const { data: ces } = await sb.from("contact_events").select("contact_id").eq("event_id", eventId);
  const cids = [...new Set((ces || []).map((r) => r.contact_id))];
  const comp = {};
  for (let i = 0; i < cids.length; i += 500) {
    const { data: cs } = await sb.from("contacts").select("id,current_company_id").in("id", cids.slice(i, i + 500));
    for (const c of cs || []) if (c.current_company_id) comp[c.current_company_id] = (comp[c.current_company_id] || 0) + 1;
  }
  return { comp, total: cids.length };
}

async function companyPagePosts(eventId) {
  // company_id -> count of non-rejected company-authored posts (organizer/announcement voice)
  const { data: posts } = await sb.from("posts").select("company_id,author_type,post_type").eq("event_id", eventId).eq("author_type", "company").not("company_id", "is", null);
  const cnt = {};
  for (const p of posts || []) { if ((p.post_type || "").includes("rejected")) continue; cnt[p.company_id] = (cnt[p.company_id] || 0) + 1; }
  return cnt;
}

async function companiesByIds(ids) {
  const out = {};
  const list = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < list.length; i += 300) {
    const { data } = await sb.from("companies").select("id,name,normalized_name").in("id", list.slice(i, i + 300));
    for (const c of data || []) out[c.id] = c;
  }
  return out;
}

// Return the best candidate for one event, or null. Each candidate: {companyId, tier, why, share, pagePosts, contacts, total}
async function suggestForEvent(ev, minContacts) {
  const { comp, total } = await contactShare(ev.id);
  const pageCnt = await companyPagePosts(ev.id);
  const cand = new Set([...Object.keys(comp), ...Object.keys(pageCnt)]);
  if (cand.size === 0) return null;
  const compMeta = await companiesByIds([...cand]);
  const evTokens = tokens(ev.name);
  const evName = (ev.name || "").toLowerCase();

  let best = null;
  const consider = (companyId, tier, score, why) => {
    const c = compMeta[companyId];
    const contacts = comp[companyId] || 0;
    const item = { companyId, name: c?.name, tier, score, why, share: total ? contacts / total : 0, pagePosts: pageCnt[companyId] || 0, contacts, total };
    if (!best || score > best.score) best = item;
  };

  // How many candidate companies each event-token matches — a token that hits many companies is generic.
  const tokenHits = {};
  for (const t of evTokens) {
    for (const companyId of cand) {
      const norm = compMeta[companyId]?.normalized_name || compMeta[companyId]?.name?.toLowerCase() || "";
      if (new RegExp(`\\b${t}\\b`).test(norm)) tokenHits[t] = (tokenHits[t] || 0) + 1;
    }
  }

  for (const companyId of cand) {
    const c = compMeta[companyId];
    if (!c) continue;
    const norm = c.normalized_name || c.name?.toLowerCase() || "";
    const contacts = comp[companyId] || 0;
    const share = total ? contacts / total : 0;
    const pp = pageCnt[companyId] || 0;

    // Tier A: distinctive event-name token appears in the company name. Prefer the longest match.
    const matched = evTokens.filter((t) => new RegExp(`\\b${t}\\b`).test(norm)).sort((a, b) => b.length - a.length);
    const matchTok = matched[0];
    // A token is "distinctive" if it is not a generic industry/geo word and it uniquely picks one company.
    const distinctive = matchTok && !GENERIC_WORDS.has(matchTok) && tokenHits[matchTok] === 1;
    if (matchTok && total >= 2) {
      if (distinctive) { consider(companyId, "A name-match", 1000 + matchTok.length, `name shares "${matchTok}"`); continue; }
      // Weak name match: only trust it when the company also dominates the crowd.
      if (total >= minContacts && (share >= 0.25 || (pp >= 1 && share >= 0.1))) {
        consider(companyId, "A weak+host", 600 + Math.round(share * 100), `name shares generic "${matchTok}" + ${Math.round(share * 100)}% of contacts`);
        continue;
      }
    }

    // Tier C: curated seed alias (name does not match but host is known).
    const seed = SEED_ALIASES.find((s) => evName.includes(s.eventLike) && norm.includes(s.companyLike));
    if (seed) { consider(companyId, "C seed-map", 900 + pp, `seed alias ${seed.eventLike} -> ${seed.companyLike}`); continue; }

    // Tier B: host dominance. Company posts as itself AND owns a big share of the crowd.
    if (total >= minContacts && ((pp >= 1 && share >= 0.25) || (pp >= 2 && share >= 0.15) || share >= 0.5)) {
      consider(companyId, "B dominance", 500 + pp * 10 + Math.round(share * 100), `${pp} company posts, ${Math.round(share * 100)}% of contacts`);
    }
  }
  return best;
}

async function doSet(pair) {
  const [eventId, companyId] = pair.split(":");
  if (!eventId || !companyId) { console.error("--set expects <eventId>:<companyId>"); process.exit(1); }
  const { data: ev } = await sb.from("events").select("id,name").eq("id", eventId).single();
  const { data: co } = await sb.from("companies").select("id,name").eq("id", companyId).single();
  if (!ev || !co) { console.error("event or company not found"); process.exit(1); }
  const { error: e1 } = await sb.from("events").update({ organizer_company_id: companyId, organizer_confidence: "confirmed" }).eq("id", eventId);
  if (e1) { console.error("set failed:", e1.message); process.exit(1); }
  const { error: e2 } = await sb.rpc("resolve_company_event_roles", { p_event_id: eventId, p_write: true });
  const { error: e3 } = await sb.rpc("refresh_event_contact_facts", { p_event_id: eventId });
  // Also refresh the cached breakdown the PUBLIC event page reads (events.facets_cache).
  // Without this the organizer only appears in the public breakdown at the nightly 03:00 UTC pass.
  const { error: e4 } = await sb.rpc("refresh_event_facets", { p_event_id: eventId });
  const { count } = await sb.from("event_contact_facts").select("*", { count: "exact", head: true }).eq("event_id", eventId).eq("role", "organizer");
  console.log(`Set organizer of "${ev.name}" -> "${co.name}".`);
  console.log(`  resolve: ${e2 ? e2.message : "ok"} | facts: ${e3 ? e3.message : "ok"} | facets_cache: ${e4 ? e4.message : "ok"} | contacts now organizer: ${count}`);
}

async function main() {
  const setPair = arg("set");
  if (setPair) return doSet(setPair);

  const minContacts = parseInt(arg("min", "8"), 10);
  const limit = parseInt(arg("limit", "40"), 10);
  const eventSel = arg("event");

  let q = sb.from("events").select("id,name,slug,is_active").is("organizer_company_id", null);
  if (eventSel) q = q.or(`slug.eq.${eventSel},name.ilike.%${eventSel}%`);
  else if (!flag("all")) q = q.eq("is_active", true);
  const { data: evs, error } = await q.limit(1000);
  if (error) { console.error(error.message); process.exit(1); }

  const rows = [];
  for (const ev of evs || []) {
    const best = await suggestForEvent(ev, minContacts);
    if (best) rows.push({ ev, best });
  }
  rows.sort((a, b) => b.best.score - a.best.score);

  console.log(`\nEvents with no organizer set that have a suggestion: ${rows.length} of ${evs.length} scanned`);
  console.log(`(tier A = name match, B = host dominance, C = curated seed; min contacts for B = ${minContacts})\n`);
  for (const { ev, best } of rows.slice(0, limit)) {
    console.log(`[${best.tier.padEnd(12)}] ${ev.name}`);
    console.log(`   -> ${best.name}  (${best.why})`);
    console.log(`   confirm: node scripts/suggest-organizers.mjs --set=${ev.id}:${best.companyId}\n`);
  }
  if (rows.length > limit) console.log(`... ${rows.length - limit} more (raise --limit to see them)`);
}

main();
