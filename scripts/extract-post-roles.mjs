/**
 * Phase 2 (backfill side): LLM role extraction for posts, run on the Claude subscription
 * (via subagents), NOT the paid API. This script is the deterministic half only:
 *
 *   --dump   : fetch candidate posts for an event, write them to JSONL chunk files.
 *   --ingest : read the labels JSONL (produced by the subagents), write the role fields
 *              to posts, flag speakers on contact_events, and re-resolve company_event_roles.
 *
 * In between, a subagent reads each role-cand-<slug>-NNN.jsonl, classifies every post by
 * intent, and writes role-labels-<slug>-NNN.jsonl. The resolver prefers posts.extracted_event_role
 * over its Attendee baseline, so Sponsor / Exhibitor / Speaker come from this step.
 *
 * Candidates = qualified posts that are company-page posts OR match a broad recall net
 * (sponsor/booth/exhibit/cabana/keynote/panel/...). Everything else stays Attendee (default),
 * so we never classify the thousands of plain "see you at Cannes" posts.
 *
 * Usage:
 *   node app/scripts/extract-post-roles.mjs --dump --event="cannes" --chunk=200
 *   # ...subagents classify each chunk into role-labels-<slug>-NNN.jsonl...
 *   node app/scripts/extract-post-roles.mjs --ingest --event="cannes"
 *   Options: --event-id=<uuid>  --chunk=N (posts per file, default 200)  --limit=N
 *
 * Requires app/.env.local: SUPABASE_SERVICE_ROLE_KEY  (no LLM key needed).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
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

const SUPABASE_URL = "https://citrznhubxqvsfhjkssg.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error("Missing SUPABASE_SERVICE_ROLE_KEY in app/.env.local"); process.exit(1); }
const supabase = createClient(SUPABASE_URL, KEY);

const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=").slice(1).join("=") : undefined; };
const has = (n) => process.argv.includes(`--${n}`);
const DUMP = has("dump");
const INGEST = has("ingest");
const EVENT = arg("event");
const EVENT_ID = arg("event-id");
const CHUNK = arg("chunk") ? Number(arg("chunk")) : 200;
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;
const OUT = join(__dirname, "output");

// Broad recall net: anything that MIGHT be more than a plain attendee. The LLM confirms intent.
const CANDIDATE_RE = new RegExp(
  "(sponsor|booth|exhibit|cabana|\\bvilla\\b|pavilion|lounge|\\bsuite\\b|\\bstand\\b|activation|" +
  "hosting|we host|hosted|keynote|\\bspeak|\\bpanel\\b|\\bsession\\b|fireside|\\bstage\\b|presenting|" +
  "present at|visit us|stop by|come see|see us at|find us|drop by|swing by|join us at|our team will|" +
  "we will be at|we.?ll be at|excited to be at|proud to)", "i");

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function resolveEvent() {
  if (EVENT_ID) {
    const { data } = await supabase.from("events").select("id,name").eq("id", EVENT_ID).single();
    return data;
  }
  if (!EVENT) { console.error("Pass --event=\"name\" or --event-id=<uuid>"); process.exit(1); }
  const { data, error } = await supabase.from("events").select("id,name").ilike("name", `%${EVENT}%`);
  if (error) throw error;
  if (!data?.length) { console.error(`No event matches "${EVENT}"`); process.exit(1); }
  if (data.length > 1) { console.error("Ambiguous:", data.map((e) => `${e.name} (${e.id})`).join(" | ")); process.exit(1); }
  return data[0];
}

async function fetchQualified(eventId) {
  const PAGE = 1000;
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("posts")
      .select("id, author_type, content, contact_id")
      .eq("event_id", eventId)
      .not("post_type", "is", null)
      .not("post_type", "like", "%rejected%")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

async function doDump() {
  const ev = await resolveEvent();
  console.log(`Event: ${ev.name} (${ev.id})`);
  const all = await fetchQualified(ev.id);
  let cands = all.filter((p) => p.author_type === "company" || CANDIDATE_RE.test(p.content || ""));
  if (LIMIT !== Infinity) cands = cands.slice(0, LIMIT);
  console.log(`Qualified: ${all.length}  |  candidates: ${cands.length}`);
  const s = slug(ev.name);
  const parts = chunk(cands, CHUNK);
  for (let i = 0; i < parts.length; i++) {
    const file = join(OUT, `role-cand-${s}-${String(i).padStart(3, "0")}.jsonl`);
    const body = parts[i].map((p) => JSON.stringify({
      id: p.id, author_type: p.author_type || "person",
      content: (p.content || "").replace(/\s+/g, " ").slice(0, 800),
    })).join("\n");
    writeFileSync(file, body);
  }
  console.log(`Wrote ${parts.length} chunk file(s) of <=${CHUNK} to ${OUT}/role-cand-${s}-*.jsonl`);
  console.log(`Next: have subagents classify each into role-labels-${s}-NNN.jsonl, then run --ingest.`);
}

async function doIngest() {
  const ev = await resolveEvent();
  const s = slug(ev.name);
  const files = readdirSync(OUT).filter((f) => f.startsWith(`role-labels-${s}-`) && f.endsWith(".jsonl"));
  if (!files.length) { console.error(`No role-labels-${s}-*.jsonl in ${OUT}`); process.exit(1); }
  const labels = [];
  for (const f of files) for (const line of readFileSync(join(OUT, f), "utf8").split("\n")) {
    const t = line.trim(); if (!t) continue;
    try { labels.push(JSON.parse(t)); } catch { console.error("  bad label line in", f); }
  }
  console.log(`Loaded ${labels.length} labels from ${files.length} file(s).`);

  let wrote = 0;
  const speakers = [];
  for (const l of labels) {
    const role = ["sponsor", "exhibitor", "organizer", "attendee"].includes(l.event_role) ? l.event_role : "attendee";
    const conf = ["high", "medium", "low"].includes(l.confidence) ? l.confidence : "low";
    const { error } = await supabase.from("posts").update({
      extracted_event_role: role, role_is_speaker: !!l.is_speaker,
      role_evidence: (l.evidence || "").slice(0, 300), role_confidence: conf,
    }).eq("id", l.id);
    if (error) { console.error("  post update failed:", l.id, error.message); continue; }
    wrote++;
    if (l.is_speaker && l.contact_id) speakers.push(l.contact_id);
  }
  console.log(`Wrote role fields to ${wrote}/${labels.length} posts.`);

  // Speakers: derive contact_id from the post when the label did not carry it.
  const spkPosts = labels.filter((l) => l.is_speaker).map((l) => l.id);
  if (spkPosts.length) {
    const ids = new Set();
    for (const part of chunk(spkPosts, 300)) {
      const { data } = await supabase.from("posts").select("contact_id").in("id", part);
      for (const r of data || []) if (r.contact_id) ids.add(r.contact_id);
    }
    const uniq = [...ids];
    for (const part of chunk(uniq, 200)) {
      const { error } = await supabase.from("contact_events").update({ is_speaker: true }).eq("event_id", ev.id).in("contact_id", part);
      if (error) console.error("  speaker flag failed:", error.message);
    }
    console.log(`Flagged ${uniq.length} contacts as speakers for this event.`);
  }

  const { error: rerr } = await supabase.rpc("resolve_company_event_roles", { p_event_id: ev.id, p_write: true });
  if (rerr) console.error("  re-resolve failed:", rerr.message);
  else console.log("Re-resolved company_event_roles for the event.");

  const { data: dist } = await supabase.from("company_event_roles").select("role").eq("event_id", ev.id);
  const counts = {};
  for (const r of dist || []) counts[r.role] = (counts[r.role] || 0) + 1;
  console.log("Resolved roles:", counts);
}

(async () => {
  if (DUMP) return doDump();
  if (INGEST) return doIngest();
  console.error("Pass --dump or --ingest");
  process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
