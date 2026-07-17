/**
 * Read-only validation of the Phase 1 classifiers against live Supabase data.
 * No writes. Samples contacts + companies, applies classify.mjs, and prints
 * the resulting bucket distributions + the most common titles with their
 * assigned buckets so we can eyeball accuracy before any backfill.
 *
 * Usage:  node app/scripts/classify-validate.mjs [--sample=50000]
 * Requires app/.env.local: SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifySeniority,
  classifyFunction,
  classifySize,
  classifyIndustry,
} from "./lib/classify.mjs";

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

const SAMPLE = Number((process.argv.find((a) => a.startsWith("--sample=")) || "").split("=")[1]) || 50000;

async function fetchAll(table, columns, cap) {
  const rows = [];
  const page = 1000;
  for (let from = 0; from < cap; from += page) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + page - 1);
    if (error) { console.error(`fetch ${table}:`, error.message); break; }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < page) break;
  }
  return rows;
}

function dist(rows, fn) {
  const m = new Map();
  for (const r of rows) {
    const k = fn(r) ?? "(null)";
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function printDist(title, entries, total) {
  console.log(`\n=== ${title} (n=${total}) ===`);
  for (const [k, n] of entries) {
    console.log(`  ${String(k).padEnd(26)} ${String(n).padStart(7)}  ${(100 * n / total).toFixed(1)}%`);
  }
}

(async () => {
  console.log(`Sampling up to ${SAMPLE} rows per table...`);

  // ---- Contacts: seniority + function ----
  const contacts = await fetchAll("contacts", "current_title,headline", SAMPLE);
  printDist("SENIORITY", dist(contacts, (c) => classifySeniority(c.current_title)), contacts.length);
  printDist("FUNCTION", dist(contacts, (c) => classifyFunction(c.current_title, c.headline).bucket), contacts.length);

  // Most common titles in the sample + how each is classified.
  const titleCount = new Map();
  for (const c of contacts) {
    const t = (c.current_title || "").trim();
    if (t) titleCount.set(t, (titleCount.get(t) || 0) + 1);
  }
  const top = [...titleCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  console.log(`\n=== TOP 40 TITLES -> assigned buckets ===`);
  for (const [t, n] of top) {
    console.log(`  ${String(n).padStart(5)}  ${t.slice(0, 36).padEnd(38)} ${String(classifySeniority(t)).padEnd(14)} ${classifyFunction(t).bucket}`);
  }

  // Diagnostic: most common titles landing in the catch-all buckets.
  function topIn(bucketName, fn) {
    const m = new Map();
    for (const c of contacts) {
      const t = (c.current_title || "").trim();
      if (t && fn(c) === bucketName) m.set(t, (m.get(t) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  }
  console.log(`\n=== TOP titles in SENIORITY=Other ===`);
  for (const [t, n] of topIn("Other", (c) => classifySeniority(c.current_title))) console.log(`  ${String(n).padStart(5)}  ${t}`);
  console.log(`\n=== TOP titles in FUNCTION=Other ===`);
  for (const [t, n] of topIn("Other", (c) => classifyFunction(c.current_title, c.headline).bucket)) console.log(`  ${String(n).padStart(5)}  ${t}`);

  // ---- Companies: size + industry ----
  const companies = await fetchAll("companies", "size_range,employee_count,industry", SAMPLE);
  printDist("COMPANY SIZE", dist(companies, (c) => classifySize(c.size_range, c.employee_count)), companies.length);
  const indEntries = dist(companies, (c) => classifyIndustry(c.industry));
  printDist("INDUSTRY BUCKET", indEntries, companies.length);
  const nullInd = indEntries.find((e) => e[0] === "(null)");
  console.log(`\nIndustry rows needing LLM fallback (unmapped): ${nullInd ? nullInd[1] : 0}`);
})();
