/**
 * Identifies event pages that should be deindexed from Google.
 *
 * An event is flagged if it matches ANY of:
 *   1. End date > 30 days ago (past events)
 *   2. Start date > 6 months in the future (too early to rank)
 *   3. GSC impressions in last 28 days < 3 (optional — requires GSC Pages CSV)
 *
 * Rule 3 only runs when --gsc=<path> is provided.
 *
 * Usage:
 *   node app/scripts/prune-event-pages.mjs
 *   node app/scripts/prune-event-pages.mjs --gsc="/path/to/Pages.csv"
 *   node app/scripts/prune-event-pages.mjs --gsc="..." --apply
 *
 * Default is dry-run: prints the candidate list to stdout.
 * With --apply, writes `app/src/config/noindexed-event-slugs.json`.
 * The event page route must be updated separately to read this file.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const path = join(__dirname, "../.env.local");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvLocal();

const SUPABASE_URL = "https://citrznhubxqvsfhjkssg.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) {
  console.error("Missing env: SUPABASE_SERVICE_ROLE_KEY (expected in app/.env.local)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const gscPath = args.find((a) => a.startsWith("--gsc="))?.split("=")[1];
const apply = args.includes("--apply");

const DAYS_PAST_CUTOFF = 180;
const MONTHS_FUTURE_CUTOFF = 6;
const MIN_IMPRESSIONS = 3;

function parseGscCsv(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n").slice(1).filter(Boolean);
  const map = new Map();
  for (const line of lines) {
    const [url, clicks, impressions] = line.split(",");
    if (!url?.includes("/events/")) continue;
    const slug = url.replace(/.*\/events\//, "").replace(/\/$/, "").replace(/"/g, "");
    map.set(slug, {
      clicks: Number(clicks) || 0,
      impressions: Number(impressions) || 0,
    });
  }
  return map;
}

async function main() {
  const gscData = gscPath ? parseGscCsv(gscPath) : null;
  if (gscData) {
    console.log(`Loaded GSC data for ${gscData.size} event pages`);
  } else {
    console.log("No --gsc flag: skipping impression-based pruning");
  }

  const events = [];
  let start = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("events")
      .select("slug, name, year, start_date, end_date")
      .range(start, start + pageSize - 1);
    if (error) throw new Error(`Query failed: ${error.message}`);
    events.push(...(data || []));
    if (!data || data.length < pageSize) break;
    start += pageSize;
  }
  console.log(`Loaded ${events.length} events from Supabase`);

  const now = new Date();
  const pastCutoff = new Date(now);
  pastCutoff.setDate(pastCutoff.getDate() - DAYS_PAST_CUTOFF);
  const futureCutoff = new Date(now);
  futureCutoff.setMonth(futureCutoff.getMonth() + MONTHS_FUTURE_CUTOFF);

  const flagged = [];
  const kept = [];

  for (const e of events) {
    const reasons = [];
    const endDate = e.end_date ? new Date(e.end_date) : null;
    const startDate = e.start_date ? new Date(e.start_date) : null;

    if (endDate && endDate < pastCutoff) {
      reasons.push(`ended ${endDate.toISOString().slice(0, 10)}`);
    }
    if (startDate && startDate > futureCutoff) {
      reasons.push(`starts ${startDate.toISOString().slice(0, 10)} (>6mo out)`);
    }
    if (gscData) {
      const gsc = gscData.get(e.slug);
      const impressions = gsc?.impressions ?? 0;
      const inWindow =
        (!endDate || endDate >= pastCutoff) &&
        (!startDate || startDate <= futureCutoff);
      if (inWindow && impressions < MIN_IMPRESSIONS) {
        reasons.push(`${impressions} impressions (<${MIN_IMPRESSIONS})`);
      }
    }

    if (reasons.length > 0) {
      flagged.push({ slug: e.slug, name: e.name, year: e.year, reasons });
    } else {
      kept.push(e.slug);
    }
  }

  console.log(`\nFlagged for noindex: ${flagged.length}`);
  console.log(`Keeping indexed: ${kept.length}\n`);

  const byReason = { past: 0, future: 0, lowImpressions: 0 };
  for (const f of flagged) {
    for (const r of f.reasons) {
      if (r.startsWith("ended")) byReason.past++;
      else if (r.startsWith("starts")) byReason.future++;
      else if (r.includes("impressions")) byReason.lowImpressions++;
    }
  }
  console.log("Reasons breakdown:");
  console.log(`  Past events (ended >${DAYS_PAST_CUTOFF}d ago): ${byReason.past}`);
  console.log(`  Too-far-future (>${MONTHS_FUTURE_CUTOFF}mo): ${byReason.future}`);
  console.log(`  Low impressions (<${MIN_IMPRESSIONS}): ${byReason.lowImpressions}\n`);

  console.log("Sample of flagged events:");
  for (const f of flagged.slice(0, 20)) {
    console.log(`  ${f.slug} — ${f.reasons.join("; ")}`);
  }
  if (flagged.length > 20) console.log(`  ...and ${flagged.length - 20} more`);

  if (!apply) {
    console.log("\nDry run. Pass --apply to write noindex config file.");
    return;
  }

  const outputPath = join(__dirname, "../src/config/noindexed-event-slugs.json");
  const output = {
    generated: new Date().toISOString().slice(0, 10),
    count: flagged.length,
    slugs: flagged.map((f) => f.slug).sort(),
  };
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${flagged.length} slugs to ${outputPath}`);
  console.log("Next step: update app/src/app/events/[slug]/page.tsx to import this file");
  console.log("and emit <meta name=\"robots\" content=\"noindex\"> for matching slugs.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
