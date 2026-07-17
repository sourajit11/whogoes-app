#!/usr/bin/env node
// One-off: unlock contacts for a customer across many events and write a CSV.
// Modes: dryrun (no spend), preview (unlock N from one event), full (run the whole list)
//
// Usage:
//   node app/scripts/export-customer-contacts.mjs --mode=dryrun
//   node app/scripts/export-customer-contacts.mjs --mode=preview --preview-count=100 --preview-event=modex-2026
//   node app/scripts/export-customer-contacts.mjs --mode=full --out=./lewis_contacts.csv

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(__dirname, "..");

// ---- env ----
const env = Object.fromEntries(
  readFileSync(join(APP_DIR, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in app/.env.local");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ---- args ----
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, "").split("=");
    return [k, rest.join("=") || true];
  })
);
const MODE = args.mode || "dryrun";
const OUT = args.out || `./customer_contacts_${new Date().toISOString().slice(0, 10)}.csv`;
const USER_EMAIL = args.user || "lewis@helloyellow.ai";
const PREVIEW_COUNT = parseInt(args["preview-count"] || "100", 10);
const PREVIEW_EVENT = args["preview-event"] || "modex-2026";

// ---- Lewis's 27-event manifest (slug → target unlock count) ----
const MANIFEST = [
  { slug: "modex-2026", count: 2175, label: "MODEX" },
  { slug: "himss-2026", count: 2154, label: "HIMSS" },
  { slug: "rsac-2026", count: 1731, label: "RSA Conference" },
  { slug: "isc-west-2026", count: 1402, label: "ISC West" },
  { slug: "google-cloud-next-26-2026", count: 1130, label: "Google Cloud Next '26" },
  { slug: "shoptalk-spring-2026", count: 820, label: "Shoptalk Spring" },
  { slug: "vive-2026", count: 806, label: "ViVE (mapped from ViVE 2027)" },
  { slug: "fintech-meetup-2026-las-vegas", count: 294, label: "Fintech Meetup 2026, Las Vegas" },
  { slug: "consensus-2026", count: 248, label: "Consensus" },
  { slug: "transact2026", count: 222, label: "TRANSACT2026" },
  { slug: "bitcoin-2026", count: 184, label: "Bitcoin 2026" },
  { slug: "hpe-discover-las-vegas-2026", count: 154, label: "HPE Discover Las Vegas 2026" },
  { slug: "sap-sapphire-asug-conference-2026", count: 126, label: "SAP Sapphire (Orlando)" },
  { slug: "dell-technologies-world-2026", count: 118, label: "Dell Technologies World" },
  { slug: "bio-international-convention-2026", count: 109, label: "BIO International Convention 2026" },
  { slug: "cisco-live-usa-2026", count: 97, label: "Cisco Live USA 2026" },
  { slug: "snowflake-summit-2026", count: 59, label: "Snowflake Summit" },
  { slug: "servicenow-knowledge-26-2026", count: 57, label: "ServiceNow Knowledge 26" },
  { slug: "the-nama-show-2026", count: 55, label: "The NAMA Show 2026" },
  { slug: "sbc-summit-americas-2026", count: 35, label: "SBC Summit Fort Lauderdale (mapped to Americas)" },
  { slug: "bio-it-world-conference-2026", count: 32, label: "Bio-IT World Conference" },
  { slug: "infocomm-2026", count: 26, label: "InfoComm 2026" },
  { slug: "nvidia-gtc-event-2026", count: 26, label: "NVIDIA GTC event" },
  { slug: "odsc-ai-east-2026", count: 22, label: "ODSC AI East 2026" },
  { slug: "data-ai-summit-2026", count: 7, label: "Data + AI Summit 2026" },
  { slug: "shrm-annual-conference-2026", count: 2, label: "SHRM Annual Conference 2026" },
  { slug: "saastr-ai-annual-2026", count: 2, label: "SaaStr AI Annual 2026" },
];

// ---- helpers ----
async function getUserId(email) {
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const u = data.users.find((u) => u.email === email);
  if (!u) throw new Error(`User not found: ${email}`);
  return u.id;
}

async function resolveSlugs(slugs) {
  const { data, error } = await sb.from("events").select("id,slug,name").in("slug", slugs);
  if (error) throw error;
  return Object.fromEntries(data.map((e) => [e.slug, { id: e.id, name: e.name }]));
}

async function getStatus(userId, eventId) {
  const { data, error } = await sb.rpc("api_get_event_unlock_status", {
    p_user_id: userId,
    p_event_id: eventId,
  });
  if (error) throw error;
  return data;
}

async function unlock(userId, eventId, count) {
  const { data, error } = await sb.rpc("api_unlock_event_contacts", {
    p_user_id: userId,
    p_event_id: eventId,
    p_count: count,
    p_max_to_unlock: null,
  });
  if (error) throw error;
  return data;
}

async function getUnlockedContacts(userId, eventId) {
  const all = [];
  let offset = 0;
  const PAGE = 200;
  while (true) {
    const { data, error } = await sb.rpc("api_get_unlocked_contacts", {
      p_user_id: userId,
      p_event_id: eventId,
      p_limit: PAGE,
      p_offset: offset,
    });
    if (error) throw error;
    const rows = data?.contacts || [];
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_COLUMNS = [
  "event_name",
  "event_slug",
  "full_name",
  "first_name",
  "last_name",
  "current_title",
  "contact_linkedin_url",
  "city",
  "country",
  "email",
  "email_status",
  "company_name",
  "company_domain",
  "company_website",
  "company_industry",
  "company_size",
  "company_headquarters",
  "company_founded_year",
  "company_linkedin_url",
  "post_url",
  "post_date",
  "source",
  "charged_at",
];

function rowsToCsv(rows) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvEscape(r[c])).join(","));
  return lines.join("\n");
}

// ---- main ----
const userId = await getUserId(USER_EMAIL);
console.log(`User: ${USER_EMAIL} (${userId})`);

const slugMap = await resolveSlugs(MANIFEST.map((m) => m.slug));
const missing = MANIFEST.filter((m) => !slugMap[m.slug]);
if (missing.length) {
  console.error("Slugs not found in catalog:", missing.map((m) => m.slug));
  process.exit(1);
}

if (MODE === "dryrun") {
  console.log("\n--- DRY RUN — no credits spent ---");
  console.log("event_name | slug | asked | available_total | already_unlocked | settled_remaining");
  let totalAsked = 0;
  let totalReachable = 0;
  for (const m of MANIFEST) {
    const ev = slugMap[m.slug];
    const s = await getStatus(userId, ev.id);
    const reachable = Math.min(m.count, s.unlocked_count + s.remaining_count);
    totalAsked += m.count;
    totalReachable += reachable;
    const flag = reachable < m.count ? `  ⚠ short by ${m.count - reachable}` : "";
    console.log(`${ev.name} | ${m.slug} | ${m.count} | ${s.total_contacts} | ${s.unlocked_count} | ${s.remaining_count}${flag}`);
  }
  console.log(`\nTotal asked: ${totalAsked}`);
  console.log(`Total reachable (asked, capped by available): ${totalReachable}`);
  console.log(`Shortfall: ${totalAsked - totalReachable}`);
  const balance = await sb.rpc("api_get_user_credits", { p_user_id: userId });
  console.log(`User balance: ${balance.data}`);
  process.exit(0);
}

if (MODE === "preview") {
  const ev = slugMap[PREVIEW_EVENT];
  if (!ev) {
    console.error(`Preview event ${PREVIEW_EVENT} not found`);
    process.exit(1);
  }
  console.log(`\n--- PREVIEW — unlocking ${PREVIEW_COUNT} from ${ev.name} ---`);
  const before = await sb.rpc("api_get_user_credits", { p_user_id: userId });
  console.log(`Balance before: ${before.data}`);
  const result = await unlock(userId, ev.id, PREVIEW_COUNT);
  console.log("Unlock result:", result);
  const allRows = await getUnlockedContacts(userId, ev.id);
  // Take only the most-recently-charged PREVIEW_COUNT rows for the preview CSV
  const previewRows = allRows.slice(0, PREVIEW_COUNT).map((r) => ({
    ...r,
    event_name: ev.name,
    event_slug: PREVIEW_EVENT,
  }));
  const csv = rowsToCsv(previewRows);
  const previewOut = `./preview_${PREVIEW_EVENT}_${PREVIEW_COUNT}.csv`;
  writeFileSync(previewOut, csv);
  console.log(`\nWrote ${previewRows.length} rows to ${previewOut}`);
  console.log("\n--- First 5 rows (truncated) ---");
  for (const r of previewRows.slice(0, 5)) {
    console.log({
      full_name: r.full_name,
      current_title: r.current_title,
      company_name: r.company_name,
      email: r.email,
      email_status: r.email_status,
      city: r.city,
      country: r.country,
      post_url: r.post_url ? r.post_url.slice(0, 70) + "..." : null,
    });
  }
  process.exit(0);
}

if (MODE === "full") {
  console.log("\n--- FULL EXPORT ---");
  const before = await sb.rpc("api_get_user_credits", { p_user_id: userId });
  console.log(`Balance before: ${before.data}`);
  const allRows = [];
  const summary = [];
  for (const m of MANIFEST) {
    const ev = slugMap[m.slug];
    const result = await unlock(userId, ev.id, m.count);
    const inserted = result?.contacts_unlocked || 0;
    const allForEvent = await getUnlockedContacts(userId, ev.id);
    const sliced = allForEvent.slice(0, m.count).map((r) => ({
      ...r,
      event_name: ev.name,
      event_slug: m.slug,
    }));
    allRows.push(...sliced);
    summary.push({ event: ev.name, asked: m.count, newly_unlocked: inserted, total_in_csv: sliced.length });
    console.log(`  ${ev.name}: asked=${m.count}, newly_unlocked=${inserted}, in_csv=${sliced.length}`);
  }
  const csv = rowsToCsv(allRows);
  writeFileSync(OUT, csv);
  const after = await sb.rpc("api_get_user_credits", { p_user_id: userId });
  console.log(`\nWrote ${allRows.length} rows to ${OUT}`);
  console.log(`Balance after: ${after.data}`);
  console.log(`Credits spent this run: ${before.data - after.data}`);
  console.log("\n--- Per-event summary ---");
  console.table(summary);
  process.exit(0);
}

console.error(`Unknown mode: ${MODE}`);
process.exit(1);
