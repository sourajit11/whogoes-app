/**
 * Affiliate "Event Insider" recruitment: manual CLI for one event.
 *
 * The daily automation lives in app/pipeline/lib/affiliate-recruit-core.mjs
 * (run by /api/affiliate-recruit/sync via n8n, or app/scripts/affiliate-recruit-sync.mjs).
 * This CLI is for inspection and one-off runs: qualify one event, review the
 * candidates (CSV is a review artifact only, Supabase is the source of truth),
 * and optionally insert them.
 *
 * Usage:
 *   node app/scripts/affiliate-recruit-targets.mjs --list-events
 *   node app/scripts/affiliate-recruit-targets.mjs --event "<name or uuid>" [--apply]
 *
 * Output: app/scripts/output/affiliate-recruit/<slug>-{linkedin,email}.csv
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  qualifyEventTargets, insertTargets, listWindowEvents, UUID_RE,
} from "../pipeline/lib/affiliate-recruit-core.mjs";

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
const APPLY = args.includes("--apply");
const LIST_EVENTS = args.includes("--list-events");
const eventArgIdx = args.indexOf("--event");
const EVENT_ARG = eventArgIdx >= 0 ? args[eventArgIdx + 1] : null;

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(path, header, rows) {
  const lines = [header.join(",")];
  for (const r of rows) lines.push(header.map((h) => csvEscape(r[h])).join(","));
  writeFileSync(path, lines.join("\n") + "\n");
}

async function listCandidateEvents() {
  const events = await listWindowEvents(supabase, { minDays: 14, maxDays: 42 });
  console.log("Events starting 2-6 weeks out (contact counts = non-repost links):\n");
  for (const e of events) {
    const { count } = await supabase
      .from("contact_events")
      .select("id", { count: "exact", head: true })
      .eq("event_id", e.id)
      .neq("source_type", "repost");
    e._count = count ?? 0;
  }
  events.sort((a, b) => b._count - a._count);
  for (const e of events.slice(0, 25)) {
    console.log(`  ${String(e._count).padStart(6)}  ${e.start_date}  ${e.name}  [${e.id}]`);
  }
}

async function resolveEvent(arg) {
  let query = supabase.from("events").select("id, name, year, start_date, slug, organizer_company_id");
  query = UUID_RE.test(arg) ? query.eq("id", arg) : query.ilike("name", `%${arg}%`);
  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) throw new Error(`No event matches "${arg}"`);
  if (data.length > 1) {
    console.error(`"${arg}" matches ${data.length} events — pass the uuid instead:`);
    for (const e of data) console.error(`  ${e.id}  ${e.name} ${e.year ?? ""} (${e.start_date})`);
    process.exit(1);
  }
  return data[0];
}

async function main() {
  if (LIST_EVENTS) return listCandidateEvents();
  if (!EVENT_ARG) {
    console.error('Usage: --list-events | --event "<name or uuid>" [--apply]');
    process.exit(1);
  }

  const event = await resolveEvent(EVENT_ARG);
  console.log(`Event: ${event.name} (${event.start_date}) [${event.id}]`);
  console.log(APPLY ? "Mode: APPLY (will write affiliate_recruit_targets)\n" : "Mode: dry run\n");

  const { targets, skipped, confirmed, watermark } = await qualifyEventTargets(supabase, event);
  console.log(`Confirmed contacts: ${confirmed}`);

  const byKey = (rows, key) =>
    rows.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] || 0) + 1), acc), {});
  console.log(`\nQualified: ${targets.length}`);
  console.log(`  by segment: ${JSON.stringify(byKey(targets, "segment"))}`);
  console.log(`  by channel: ${JSON.stringify(byKey(targets, "channel"))}`);
  console.log(`Skipped: ${JSON.stringify(skipped)}`);
  if (watermark) console.log(`(customer-pipeline watermark: ${watermark})`);
  if (targets.length === 0) return;

  const outDir = join(__dirname, "output", "affiliate-recruit");
  mkdirSync(outDir, { recursive: true });
  const slug = event.slug || event.id;
  const header = ["full_name", "first_name", "title", "company", "company_size", "segment", "email", "linkedin_url", "country", "event", "contact_id"];
  const liRows = targets.filter((t) => t.channel === "linkedin");
  const emRows = targets.filter((t) => t.channel === "email");
  writeCsv(join(outDir, `${slug}-linkedin.csv`), header, liRows);
  writeCsv(join(outDir, `${slug}-email.csv`), header, emRows);
  console.log(`\nWrote ${liRows.length} → output/affiliate-recruit/${slug}-linkedin.csv`);
  console.log(`Wrote ${emRows.length} → output/affiliate-recruit/${slug}-email.csv`);

  if (APPLY) {
    const n = await insertTargets(supabase, event, targets);
    console.log(`\nInserted ${n} rows into affiliate_recruit_targets — these contacts are now suppressed from the customer pipeline.`);
  } else {
    console.log("\nDry run — rerun with --apply to insert into affiliate_recruit_targets.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
