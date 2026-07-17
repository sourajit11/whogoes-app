/**
 * Daily LinkedIn Company Page event picker.
 *
 * Picks the best future event with 200+ verified contacts that we haven't
 * posted about recently. Outputs top 3 candidates with rationale.
 *
 * Usage:
 *   node app/scripts/social-pick.mjs
 *   node app/scripts/social-pick.mjs --min=200 --window=90
 *   node app/scripts/social-pick.mjs --region=US
 *   node app/scripts/social-pick.mjs --region=EU
 *
 * Flags:
 *   --min=N       Minimum contact count (default 200)
 *   --window=N    Only consider events starting within N days (default 90)
 *   --cooldown=N  Skip events posted in last N days (default 7)
 *   --region=X    Filter by region: US or EU (default: all regions)
 *   --json        Output as JSON (for piping into social-draft.mjs)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(__dirname, "..");
const REPO_ROOT = join(APP_ROOT, "..");

function loadEnv() {
  const path = join(APP_ROOT, ".env.local");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const MIN_CONTACTS = parseInt(args.min || "200", 10);
const WINDOW_DAYS = parseInt(args.window || "90", 10);
const COOLDOWN_DAYS = parseInt(args.cooldown || "7", 10);
const AS_JSON = !!args.json;
const FORCE_REFRESH = !!args.refresh;
const SKIP_REFRESH = !!args["no-refresh"];

const REGION_FILTER = args.region ? args.region.toUpperCase() : null;
if (REGION_FILTER && !["US", "EU"].includes(REGION_FILTER)) {
  console.error(`Invalid --region value "${args.region}". Use US or EU.`);
  process.exit(1);
}

// US locations match: state abbreviations, "United States", "USA", or known US cities
const US_LOCATION_PATTERNS = [
  /united states/i, /\bUSA\b/, /\bU\.S\.A\b/,
  /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/,
  /\b(New York|Los Angeles|Chicago|Houston|Phoenix|Philadelphia|San Antonio|San Diego|Dallas|San Jose|Austin|Jacksonville|Fort Worth|Columbus|Charlotte|Indianapolis|San Francisco|Seattle|Denver|Nashville|Las Vegas|Atlanta|Boston|Orlando|Miami|Detroit|Minneapolis|Portland|Sacramento|Pittsburgh|Cleveland)\b/i,
];

// EU locations: European countries and major EU cities
const EU_LOCATION_PATTERNS = [
  /\b(Germany|France|Spain|Italy|Netherlands|Belgium|Sweden|Poland|Austria|Denmark|Finland|Norway|Switzerland|Portugal|Ireland|Greece|Czech Republic|Romania|Hungary|Slovakia|Bulgaria|Croatia|Slovenia|Estonia|Latvia|Lithuania|Luxembourg|Malta|Cyprus)\b/i,
  /\b(Berlin|Munich|Frankfurt|Hamburg|Paris|Lyon|Madrid|Barcelona|Rome|Milan|Amsterdam|Brussels|Stockholm|Warsaw|Vienna|Copenhagen|Helsinki|Oslo|Zurich|Lisbon|Dublin|Athens|Prague|Budapest)\b/i,
  /\bEurope\b/i,
];

function matchesRegion(event) {
  if (!REGION_FILTER) return true;
  const loc = (event.location || "") + " " + (event.region || "");
  const patterns = REGION_FILTER === "US" ? US_LOCATION_PATTERNS : EU_LOCATION_PATTERNS;
  return patterns.some((p) => p.test(loc));
}

const SUPABASE_URL = "https://citrznhubxqvsfhjkssg.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in app/.env.local");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24));
}

function loadPostedHistory() {
  const path = join(REPO_ROOT, "social-assets/posted-events.json");
  if (!existsSync(path)) return { posts: [] };
  return JSON.parse(readFileSync(path, "utf8"));
}

function maybeRefreshSlugs() {
  // Auto-refresh on Mondays (or when --refresh is passed). Skip with --no-refresh.
  if (SKIP_REFRESH) return;
  const isMonday = new Date().getDay() === 1;
  if (!isMonday && !FORCE_REFRESH) return;

  const reason = FORCE_REFRESH ? "--refresh flag" : "Monday refresh";
  console.log(`[${reason}] Refreshing event slug cache...`);
  try {
    const dumpScript = join(APP_ROOT, "scripts/dump-event-slugs.mjs");
    execFileSync("node", [dumpScript], { stdio: "inherit" });
    console.log("Slug cache refreshed.\n");
  } catch (err) {
    console.warn(`Slug refresh failed (continuing anyway): ${err.message}\n`);
  }
}

async function main() {
  maybeRefreshSlugs();

  const today = new Date().toISOString().slice(0, 10);
  const windowEnd = new Date();
  windowEnd.setDate(windowEnd.getDate() + WINDOW_DAYS);
  const windowEndStr = windowEnd.toISOString().slice(0, 10);

  // 1. Future events in window
  const { data: events, error } = await supabase
    .from("events")
    .select("id, slug, name, year, start_date, end_date, location, region, keywords, website")
    .gte("start_date", today)
    .lte("start_date", windowEndStr)
    .order("start_date", { ascending: true });

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  // 2. Count contacts per event
  const enriched = [];
  for (const e of events) {
    const { count } = await supabase
      .from("contact_events")
      .select("contact_id", { count: "exact", head: true })
      .eq("event_id", e.id);
    enriched.push({ ...e, contacts: count || 0 });
  }

  // 3. Filter: meets minimum + optional region
  const qualified = enriched.filter(
    (e) => e.contacts >= MIN_CONTACTS && matchesRegion(e)
  );

  // 4. Cooldown: exclude recently posted
  const history = loadPostedHistory();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - COOLDOWN_DAYS);
  const recentlyPosted = new Set(
    history.posts
      .filter((p) => new Date(p.date) >= cutoff)
      .map((p) => p.event_id)
  );
  const eligible = qualified.filter((e) => !recentlyPosted.has(e.id));

  // 5. Score: balance proximity + size
  // Sweet spot is 7-30 days out (peak buzz). Penalize too-close (<3d) and too-far (>45d).
  const scored = eligible.map((e) => {
    const daysOut = daysBetween(today, e.start_date);
    let proximityBoost = 1.0;
    if (daysOut < 3) proximityBoost = 0.6;
    else if (daysOut <= 14) proximityBoost = 1.5;
    else if (daysOut <= 30) proximityBoost = 1.2;
    else if (daysOut <= 45) proximityBoost = 0.9;
    else proximityBoost = 0.7;

    const sizeScore = Math.log10(e.contacts);
    const score = sizeScore * proximityBoost;
    return { ...e, daysOut, score };
  });
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 3);

  if (AS_JSON) {
    console.log(JSON.stringify({ today, candidates: top }, null, 2));
    return;
  }

  console.log(`\nDaily Event Pick - ${today}`);
  console.log(`Window: next ${WINDOW_DAYS} days | Min contacts: ${MIN_CONTACTS} | Cooldown: ${COOLDOWN_DAYS} days${REGION_FILTER ? ` | Region: ${REGION_FILTER}` : ""}`);
  console.log(`Eligible events: ${eligible.length} (of ${qualified.length} qualified, ${enriched.length} future)\n`);

  if (top.length === 0) {
    console.log("No eligible events. Lower --min threshold or shorten --cooldown.");
    return;
  }

  console.log("TOP CANDIDATES:\n");
  top.forEach((e, i) => {
    const marker = i === 0 ? ">>> RECOMMENDED <<<" : `   Alternative ${i}`;
    console.log(`${marker}`);
    console.log(`  ${e.name} (${e.year})`);
    console.log(`  Date: ${e.start_date}${e.end_date ? ` to ${e.end_date}` : ""} (in ${e.daysOut} days)`);
    console.log(`  Location: ${e.location || e.region || "TBD"}`);
    console.log(`  Verified contacts: ${e.contacts.toLocaleString()}`);
    console.log(`  Slug: ${e.slug}`);
    console.log(`  Keywords: ${(e.keywords || []).join(", ") || "none"}`);
    console.log(`  Score: ${e.score.toFixed(2)}`);
    console.log();
  });

  console.log("Next step: run social-draft.mjs with the chosen slug, e.g.");
  console.log(`  node app/scripts/social-draft.mjs --slug=${top[0].slug}\n`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
