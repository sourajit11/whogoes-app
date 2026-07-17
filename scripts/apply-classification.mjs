/**
 * Phase 1 backfill: write seniority/function/size/industry buckets to Supabase
 * using the deterministic classifiers in lib/classify.mjs.
 *
 * Dry-run by default (computes + prints distributions + a sample, writes NOTHING).
 * Pass --apply to actually update rows.
 *
 * Self-improving: every run also prints SELF-IMPROVEMENT RECOMMENDATIONS — recurring
 * titles with no seniority match (rule gaps), recurring words among FUNCTION=Other
 * (possible new buckets), unmapped industries, data-quality gaps (re-enrichment
 * candidates), and the confidence mix. Run with --force to analyse already-classified
 * rows too. These are advisory; review before changing rules/mapping/data.
 *
 * Usage:
 *   # Preview the pilot event only (no writes):
 *   node app/scripts/apply-classification.mjs --event="public sector"
 *
 *   # Apply to the pilot event:
 *   node app/scripts/apply-classification.mjs --event="public sector" --apply
 *
 *   # Apply to everything (only rows still missing a bucket):
 *   node app/scripts/apply-classification.mjs --apply
 *
 *   # Options: --event-id=<uuid>  --target=contacts|companies|all  --force  --limit=N
 *   --force re-classifies rows that already have buckets. Default skips them.
 *
 * Requires app/.env.local: SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyContact, classifyCompany } from "./lib/classify.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
(function loadEnv() {
  const p = join(__dirname, "../.env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();

const SUPABASE_URL = "https://citrznhubxqvsfhjkssg.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error("Missing SUPABASE_SERVICE_ROLE_KEY in app/.env.local"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, KEY);

const arg = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : undefined;
};
const has = (name) => process.argv.includes(`--${name}`);

const APPLY = has("apply");
const FORCE = has("force");
const TARGET = arg("target") || "all";
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;
const EVENT = arg("event");
const EVENT_ID = arg("event-id");

const PAGE = 1000;
const ID_CHUNK = 200; // uuids per PATCH so the filter stays within URL limits

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
async function fetchByIds(table, select, ids) {
  const rows = [];
  for (const c of chunk(ids, ID_CHUNK)) {
    const { data, error } = await supabase.from(table).select(select).in("id", c);
    if (error) { console.error(`fetch ${table}:`, error.message); break; }
    rows.push(...(data || []));
  }
  return rows;
}
async function fetchAll(table, select, filter) {
  const rows = [];
  for (let from = 0; from < LIMIT; from += PAGE) {
    // Stable order is required: without it, range pagination skips/duplicates rows
    // across pages (this silently left ~16k companies unprocessed on the first run).
    let q = supabase.from(table).select(select).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) { console.error(`fetch ${table}:`, error.message); break; }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE || rows.length >= LIMIT) break;
  }
  return rows.slice(0, LIMIT);
}

function distOf(values) {
  const m = new Map();
  for (const v of values) m.set(v ?? "(null)", (m.get(v ?? "(null)") || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function printDist(label, entries, total) {
  console.log(`  ${label} (n=${total}):`);
  for (const [k, n] of entries) console.log(`    ${String(k).padEnd(26)} ${String(n).padStart(6)}  ${(100 * n / total).toFixed(1)}%`);
}

// Group rows that share the same set of column values into one UPDATE each.
async function applyGroups(table, updates, keyOf) {
  const groups = new Map();
  for (const u of updates) {
    const k = keyOf(u.values);
    if (!groups.has(k)) groups.set(k, { values: u.values, ids: [] });
    groups.get(k).ids.push(u.id);
  }
  let written = 0, failed = 0;
  for (const { values, ids } of groups.values()) {
    for (const c of chunk(ids, ID_CHUNK)) {
      let { error } = await supabase.from(table).update(values).in("id", c);
      if (error) { // one retry for transient errors, then skip this chunk and keep going
        await new Promise((r) => setTimeout(r, 600));
        ({ error } = await supabase.from(table).update(values).in("id", c));
      }
      if (error) { console.error(`\n  update ${table} chunk failed (continuing):`, error.message); failed += c.length; continue; }
      written += c.length;
      process.stdout.write(`\r  ${table}: wrote ${written}/${updates.length}   `);
    }
  }
  if (written || failed) process.stdout.write("\n");
  if (failed) console.log(`  ${table}: ${failed} rows failed this pass (re-run to retry).`);
  return written;
}

// ---- Self-improvement recommendation engine ----
// Words that carry no department/level meaning, so the FUNCTION=Other theme
// scan surfaces genuinely uncovered concepts (sustainability, clinical, ...).
const STOPWORDS = new Set([
  "the", "and", "for", "with", "global", "regional", "area", "national", "international", "senior", "junior", "lead", "leader", "head", "deputy", "assistant", "chief", "officer", "vice", "president", "director", "manager", "general", "executive", "associate", "principal", "specialist", "coordinator", "member", "staff", "group", "team", "founder", "owner", "partner", "consultant", "advisor", "expert", "professional", "services", "solutions", "business", "development", "account", "sales", "marketing", "operations", "finance", "engineering", "product", "data", "legal", "compliance", "procurement", "customer", "success", "people", "talent", "human", "resources", "technology", "information", "company", "group", "ltd", "inc", "gmbh",
]);
function tokenize(s) {
  return (String(s).toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !STOPWORDS.has(w));
}
const isNonLatin = (s) => /[^\x00-\x7F]/.test(s);
const topMap = (m, n = 20) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

function printRecommendations(REC) {
  console.log("\n================ SELF-IMPROVEMENT RECOMMENDATIONS ================");
  console.log("Advisory only. Review before changing rules / mapping / data.\n");

  const senTop = topMap(REC.senOther);
  if (senTop.length) {
    console.log("[A] Titles with NO seniority match (add a rule in lib/classify.mjs):");
    for (const [t, n] of senTop) {
      const where = isNonLatin(t) ? "-> ML_SENIORITY (non-English)" : "-> englishSeniority()";
      console.log(`    ${String(n).padStart(4)}  ${t.slice(0, 40).padEnd(42)} ${where}`);
    }
    console.log("");
  }

  const themes = topMap(REC.fnTokens, 15).filter(([, n]) => n >= 3);
  if (themes.length) {
    console.log("[B] Recurring words among FUNCTION=Other (possible NEW bucket or rule):");
    for (const [tok, n] of themes) console.log(`    ${String(n).padStart(4)}  ${tok}`);
    console.log("    -> a large theme that is not a current department (e.g. sustainability/ESG,");
    console.log("       clinical, teaching, design) is a candidate for a new function bucket.\n");
  }

  const ind = topMap(REC.unmappedIndustry, 30);
  if (ind.length) {
    console.log("[C] Unmapped industries (add to company-industry-mapping.json):");
    for (const [raw, n] of ind) console.log(`    ${String(n).padStart(4)}  "${raw}"  -> ?`);
    console.log("");
  }

  console.log("[D] Data-quality gaps (improve the DATABASE via re-enrichment, not the rules):");
  console.log(`    ${REC.noSignal} contacts have neither title nor headline -> cannot classify.`);
  console.log(`    ${REC.headlineOnly} contacts resolved only via headline (vanity/empty title).`);
  console.log(`    ${REC.missingIndustry} companies have no industry value; ${REC.missingSize} have no usable size.\n`);

  const tot = REC.conf.high + REC.conf.medium + REC.conf.low || 1;
  console.log("[E] Confidence mix:");
  console.log(`    high   ${String(REC.conf.high).padStart(6)}  ${(100 * REC.conf.high / tot).toFixed(1)}%  (from the title)`);
  console.log(`    medium ${String(REC.conf.medium).padStart(6)}  ${(100 * REC.conf.medium / tot).toFixed(1)}%  (from the headline)`);
  console.log(`    low    ${String(REC.conf.low).padStart(6)}  ${(100 * REC.conf.low / tot).toFixed(1)}%  (unresolved - review)`);
  console.log("==================================================================\n");
}

async function resolveEventScope() {
  if (!EVENT && !EVENT_ID) return null;
  let evId = EVENT_ID;
  let evName = EVENT_ID;
  if (!evId) {
    const { data, error } = await supabase.from("events").select("id,name").ilike("name", `%${EVENT}%`);
    if (error || !data || data.length === 0) { console.error("Event not found for", EVENT); process.exit(1); }
    if (data.length > 1) console.log("Multiple events matched; using first:", data.map((e) => e.name).join(" | "));
    evId = data[0].id; evName = data[0].name;
  }
  // contact ids for the event
  const contactIds = new Set();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("contact_events").select("contact_id").eq("event_id", evId).range(from, from + PAGE - 1);
    if (error) { console.error("contact_events:", error.message); break; }
    if (!data || data.length === 0) break;
    for (const r of data) contactIds.add(r.contact_id);
    if (data.length < PAGE) break;
  }
  return { evId, evName, contactIds: [...contactIds] };
}

(async () => {
  console.log(`Mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"} | force=${FORCE} | target=${TARGET}`);
  const scope = await resolveEventScope();
  if (scope) console.log(`Scope: event "${scope.evName}" (${scope.contactIds.length} contacts)`);
  else console.log("Scope: ALL events");

  const REC = { senOther: new Map(), fnTokens: new Map(), unmappedIndustry: new Map(), noSignal: 0, headlineOnly: 0, missingIndustry: 0, missingSize: 0, conf: { high: 0, medium: 0, low: 0 } };

  // ---------------- Contacts ----------------
  if (TARGET === "all" || TARGET === "contacts") {
    let contacts;
    if (scope) {
      contacts = await fetchByIds("contacts", "id,current_title,headline,seniority_bucket,function_bucket", scope.contactIds);
      if (!FORCE) contacts = contacts.filter((c) => c.seniority_bucket == null || c.function_bucket == null);
    } else {
      contacts = await fetchAll("contacts", "id,current_title,headline,seniority_bucket,function_bucket",
        FORCE ? null : (q) => q.or("seniority_bucket.is.null,function_bucket.is.null"));
    }
    const updates = contacts.map((c) => {
      const r = classifyContact(c.current_title, c.headline);
      REC.conf[r.classification_confidence]++;
      const hasT = !!(c.current_title && c.current_title.trim());
      const hasH = !!(c.headline && c.headline.trim());
      if (!hasT && !hasH) REC.noSignal++;
      if (r.classification_confidence === "medium") REC.headlineOnly++;
      if (r.seniority_bucket === "Other" && hasT) {
        const key = c.current_title.trim();
        REC.senOther.set(key, (REC.senOther.get(key) || 0) + 1);
      }
      if (r.function_bucket === "Other") {
        // Title only: headlines carry company names ("Carahsoft", "AWS") that pollute the theme scan.
        for (const tok of tokenize(c.current_title || "")) REC.fnTokens.set(tok, (REC.fnTokens.get(tok) || 0) + 1);
      }
      return { id: c.id, values: { ...r, classified_at: new Date().toISOString() } };
    });
    console.log(`\nCONTACTS to process: ${updates.length}`);
    printDist("seniority", distOf(updates.map((u) => u.values.seniority_bucket)), updates.length || 1);
    printDist("function", distOf(updates.map((u) => u.values.function_bucket)), updates.length || 1);
    console.log("  sample:");
    for (const c of contacts.slice(0, 12)) {
      const r = classifyContact(c.current_title, c.headline);
      console.log(`    ${String(c.current_title || "(none)").slice(0, 34).padEnd(36)} ${String(r.seniority_bucket).padEnd(14)} ${r.function_bucket}`);
    }
    if (APPLY && updates.length) {
      const w = await applyGroups("contacts", updates, (v) => `${v.seniority_bucket}|${v.function_bucket}|${v.classification_confidence}`);
      console.log(`  contacts updated: ${w}`);
    }
  }

  // ---------------- Companies ----------------
  if (TARGET === "all" || TARGET === "companies") {
    let companies;
    if (scope) {
      // companies of the event's contacts
      const cc = await fetchByIds("contacts", "current_company_id", scope.contactIds);
      const companyIds = [...new Set(cc.map((r) => r.current_company_id).filter(Boolean))];
      companies = await fetchByIds("companies", "id,industry,size_range,employee_count,industry_bucket,size_bucket", companyIds);
      if (!FORCE) companies = companies.filter((c) => c.industry_bucket == null || c.size_bucket == null);
    } else {
      companies = await fetchAll("companies", "id,industry,size_range,employee_count,industry_bucket,size_bucket",
        FORCE ? null : (q) => q.or("industry_bucket.is.null,size_bucket.is.null"));
    }
    const updates = companies.map((c) => {
      const v = classifyCompany(c);
      if (v.industry_bucket == null) {
        if (c.industry && String(c.industry).trim()) REC.unmappedIndustry.set(c.industry, (REC.unmappedIndustry.get(c.industry) || 0) + 1);
        else REC.missingIndustry++;
      }
      if (v.size_bucket == null) REC.missingSize++;
      return { id: c.id, values: v };
    });
    console.log(`\nCOMPANIES to process: ${updates.length}`);
    printDist("industry_bucket", distOf(updates.map((u) => u.values.industry_bucket)), updates.length || 1);
    printDist("size_bucket", distOf(updates.map((u) => u.values.size_bucket)), updates.length || 1);
    console.log("  sample:");
    for (const c of companies.slice(0, 12)) {
      const r = classifyCompany(c);
      console.log(`    ${String(c.industry || "(none)").slice(0, 32).padEnd(34)} -> ${String(r.industry_bucket).padEnd(34)} ${r.size_bucket}`);
    }
    if (APPLY && updates.length) {
      const w = await applyGroups("companies", updates, (v) => `${v.industry_bucket}|${v.size_bucket}`);
      console.log(`  companies updated: ${w}`);
    }
  }

  printRecommendations(REC);
  console.log(`Done (${APPLY ? "APPLIED" : "dry-run"}).`);
})();
