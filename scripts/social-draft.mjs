/**
 * Generates a ready-to-paste LinkedIn Company Page event spotlight post.
 *
 * - Fetches event from Supabase
 * - Builds post copy (Format A: headcount tease)
 * - Builds hashtags from event.keywords + standard tags
 * - Renders the OG-style social card locally via satori
 * - Saves PNG to social-assets/output/
 * - Appends entry to social-assets/posted-events.json
 *
 * Usage:
 *   node app/scripts/social-draft.mjs --slug=ifat-munich-2026
 *   node app/scripts/social-draft.mjs --slug=... --dry-run
 *   node app/scripts/social-draft.mjs --slug=... --base=http://localhost:3000
 *
 * Flags:
 *   --slug=X      Required. Event slug.
 *   --dry-run     Print the post but don't save image or update history.
 *   --base=URL    Base URL for the event link (default: NEXT_PUBLIC_CONTENT_DOMAIN or https://whogoes.co)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

const SLUG = args.slug;
const DRY_RUN = !!args["dry-run"];
// Event pages live on the content domain (whogoes.co) after the domain
// consolidation. Mirror the app's NEXT_PUBLIC_CONTENT_DOMAIN so the link in
// the first comment points at the canonical apex URL, not the old subdomain.
const CONTENT_DOMAIN = process.env.NEXT_PUBLIC_CONTENT_DOMAIN?.trim().replace(/\/+$/, "");
const BASE_URL = args.base || CONTENT_DOMAIN || "https://whogoes.co";

if (!SLUG) {
  console.error("Missing --slug. Run social-pick.mjs first to find one.");
  process.exit(1);
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

function hashtagify(keyword) {
  // Strip non-alphanumeric, preserve original casing for multi-word tags.
  const cleaned = keyword.replace(/[^a-zA-Z0-9]/g, "");
  if (!cleaned) return null;
  return `#${cleaned}`;
}

function buildHashtags(event) {
  const tags = new Set();
  for (const kw of event.keywords || []) {
    const t = hashtagify(kw);
    if (t) tags.add(t);
  }
  // Standard community tags. Cap at 5 total.
  const standard = ["#B2BMarketing", "#EventMarketing", "#TradeShow"];
  for (const t of standard) {
    if (tags.size >= 5) break;
    tags.add(t);
  }
  return [...tags].slice(0, 5);
}

function formatEventDates(start, end) {
  const opts = { month: "short", day: "numeric" };
  const s = new Date(start).toLocaleDateString("en-US", opts);
  if (!end || end === start) return s;
  const e = new Date(end).toLocaleDateString("en-US", opts);
  return `${s}-${e}`;
}

function buildPost(event) {
  const today = new Date().toISOString().slice(0, 10);
  const daysOut = daysBetween(today, event.start_date);
  const dateStr = formatEventDates(event.start_date, event.end_date);
  const loc = event.location || event.region || "";
  const url = `${BASE_URL}/events/${event.slug}`;
  const hashtags = buildHashtags(event);

  const proximityLine =
    daysOut <= 0
      ? `${event.name} is happening now.`
      : daysOut === 1
      ? `${event.name} kicks off tomorrow.`
      : daysOut <= 14
      ? `${event.name} is ${daysOut} days away.`
      : `${event.name} is coming up on ${dateStr}${loc ? ` in ${loc}` : ""}.`;

  // Body: hook + stat + tease. No URL (LinkedIn suppresses outbound links).
  const body = [
    proximityLine,
    "",
    `We've already verified ${event.contacts.toLocaleString()} confirmed attendees from LinkedIn posts.`,
    "",
    "Full attendee breakdown linked in the comments.",
    "",
    hashtags.join(" "),
  ].join("\n");

  // First comment: drop the URL here within 60 seconds of posting.
  const firstComment = `Here's the full breakdown: ${url}`;

  return { body, firstComment, hashtags, url, daysOut, dateStr };
}

function renderSocialCardLocal(event, outPath) {
  const generator = join(REPO_ROOT, "social-assets/generator/render-card.mjs");
  if (!existsSync(generator)) {
    throw new Error(`Local generator missing: ${generator}`);
  }
  const generatorArgs = [
    generator,
    `--name=${event.name}`,
    `--count=${event.contacts}`,
    `--out=${outPath}`,
  ];
  if (event.location) generatorArgs.push(`--location=${event.location}`);
  if (event.start_date) generatorArgs.push(`--date=${event.start_date}`);

  execFileSync("node", generatorArgs, {
    cwd: join(REPO_ROOT, "social-assets/generator"),
    stdio: ["ignore", "ignore", "inherit"],
  });

  const stat = readFileSync(outPath);
  return { url: "(local satori render)", bytes: stat.length };
}

function appendHistory(entry) {
  const path = join(REPO_ROOT, "social-assets/posted-events.json");
  const state = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { posts: [] };
  state.posts ||= [];
  state.posts.push(entry);
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
}

async function main() {
  // Fetch event with contact count
  const { data: events, error } = await supabase
    .from("events")
    .select("id, slug, name, year, start_date, end_date, location, region, keywords, website")
    .eq("slug", SLUG)
    .limit(1);

  if (error || !events || events.length === 0) {
    console.error(`Event not found for slug: ${SLUG}`);
    if (error) console.error(error.message);
    process.exit(1);
  }
  const event = events[0];

  const { count } = await supabase
    .from("contact_events")
    .select("contact_id", { count: "exact", head: true })
    .eq("event_id", event.id);
  event.contacts = count || 0;

  // Build post
  const post = buildPost(event);
  const today = new Date().toISOString().slice(0, 10);
  const imageName = `${today}-${event.slug}.png`;
  const imagePath = join(REPO_ROOT, "social-assets/output", imageName);

  console.log("\n========== READY TO POST (LinkedIn Company Page) ==========\n");
  console.log("EVENT:");
  console.log(`  ${event.name} (${event.year})`);
  console.log(`  ${post.dateStr} | ${event.location || event.region || "TBD"}`);
  console.log(`  ${event.contacts.toLocaleString()} verified contacts | in ${post.daysOut} days\n`);
  console.log("--- POST BODY (paste this first, no link) ---");
  console.log(post.body);
  console.log("--- END POST BODY ---\n");
  console.log("--- FIRST COMMENT (paste within 60 sec of publishing the post) ---");
  console.log(post.firstComment);
  console.log("--- END FIRST COMMENT ---\n");

  if (DRY_RUN) {
    console.log("(dry run: skipping image download and history update)\n");
    return;
  }

  // Render image locally via satori
  try {
    const imgInfo = renderSocialCardLocal(event, imagePath);
    console.log(`IMAGE: saved to ${imagePath}`);
    console.log(`       (${(imgInfo.bytes / 1024).toFixed(1)} KB, ${imgInfo.url})\n`);
  } catch (err) {
    console.warn(`IMAGE: render FAILED. ${err.message}`);
    console.warn(`       Run setup if first time: cd social-assets/generator && npm install\n`);
  }

  // Append history
  appendHistory({
    date: today,
    event_id: event.id,
    slug: event.slug,
    name: event.name,
    format: "A",
    contacts_at_post: event.contacts,
    image: `social-assets/output/${imageName}`,
  });
  console.log("History updated. This event is now on cooldown for 7 days.\n");
  console.log("PASTE WORKFLOW:");
  console.log(`  1. Open the image at ${imagePath}`);
  console.log("  2. New post on LinkedIn Company Page > attach image > paste POST BODY");
  console.log("  3. Hit publish, then immediately paste FIRST COMMENT as the first reply");
  console.log("     (within 60 seconds — keeps reach high while delivering the link)\n");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
