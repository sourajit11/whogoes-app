/**
 * WhoGoes Lead Extraction Script
 *
 * Extracts contacts from Supabase for Instantly cold outreach campaigns.
 * Outputs CSV files ready for manual upload.
 *
 * Usage:
 *   node app/scripts/extract-leads.mjs upcoming   # Daily — upcoming US events
 *   node app/scripts/extract-leads.mjs past        # One-time — past US events
 *   node app/scripts/extract-leads.mjs both        # Both
 */

import { createClient } from "@supabase/supabase-js";
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config ---
const SUPABASE_URL = "https://citrznhubxqvsfhjkssg.supabase.co";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpdHJ6bmh1YnhxdnNmaGprc3NnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTMxMjkxMiwiZXhwIjoyMDg2ODg4OTEyfQ.CT7QMc5evdt5lBvOXSe4ZHbOdpZUrYMqN9VB--efbWg";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "mail.com", "protonmail.com", "zoho.com", "yandex.com",
  "live.com", "msn.com", "me.com", "qq.com", "163.com", "gmx.com",
  "yahoo.co.in", "rediffmail.com", "inbox.com", "fastmail.com",
]);

// Upcoming: event starts 5+ days from today, 100+ contacts with email
const UPCOMING_MIN_DAYS_OUT = 5;
const UPCOMING_MIN_CONTACTS = 100;
const UPCOMING_CONTACT_AGE_DAYS = 7; // only contacts created 7+ days ago

// Past: event already happened, 500+ contacts with email
const PAST_MIN_CONTACTS = 500;

// --- Helpers ---

/** Check if event is US-based using region and location fields */
function isUSEvent(event) {
  const region = (event.event_region || "").toLowerCase();
  const location = (event.event_location || "").toLowerCase();
  const patterns = ["us", "usa", "united states", "north america"];
  return patterns.some((p) => region.includes(p) || location.includes(p));
}

function isPersonalEmail(email) {
  const domain = email.split("@")[1]?.toLowerCase();
  return PERSONAL_DOMAINS.has(domain);
}

/** Paginated fetch from a table */
async function fetchAll(table, query, selectCols = "*", pageSize = 1000) {
  const results = [];
  let start = 0;
  while (true) {
    let q = supabase
      .from(table)
      .select(selectCols)
      .range(start, start + pageSize - 1);

    // Apply filters from query object
    for (const [key, val] of Object.entries(query)) {
      if (Array.isArray(val)) {
        q = q.in(key, val);
      } else if (val === null) {
        q = q.is(key, null);
      } else {
        q = q.eq(key, val);
      }
    }

    const { data, error } = await q;
    if (error) throw new Error(`Query ${table} failed: ${error.message}`);
    results.push(...(data || []));
    if (!data || data.length < pageSize) break;
    start += pageSize;
  }
  return results;
}

/** Batch fetch by IDs (handles large arrays with small batches) */
async function fetchByIds(table, column, ids, selectCols = "*") {
  if (ids.length === 0) return [];
  const BATCH = 100; // small batches to avoid URL length limits
  const results = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    // Retry up to 3 times on failure
    let attempts = 0;
    while (attempts < 3) {
      try {
        const data = await fetchAll(table, { [column]: batch }, selectCols);
        results.push(...data);
        break;
      } catch (err) {
        attempts++;
        if (attempts >= 3) throw err;
        console.log(`  Retry ${attempts}/3 for ${table} batch ${Math.floor(i / BATCH) + 1}...`);
        await new Promise((r) => setTimeout(r, 1000 * attempts));
      }
    }
    // Small delay between batches to avoid rate limits
    if (i + BATCH < ids.length) await new Promise((r) => setTimeout(r, 200));
  }
  return results;
}

function escapeCsv(val) {
  const str = String(val ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows, headers) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h])).join(","));
  }
  return lines.join("\n");
}

function daysBetween(dateStr) {
  return Math.floor(
    (new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );
}

// --- Main ---

async function main() {
  const mode = process.argv[2] || "both";

  if (!["upcoming", "past", "both"].includes(mode)) {
    console.log("Usage: node extract-leads.mjs [upcoming|past|both]");
    process.exit(1);
  }

  // Step 1: Fetch all events with contact counts via RPC
  console.log("Fetching all events via get_all_browsable_events...");
  const { data: allEvents, error } = await supabase.rpc(
    "get_all_browsable_events"
  );
  if (error) throw new Error(`RPC failed: ${error.message}`);
  console.log(`Total events: ${allEvents.length}`);

  // Show region distribution
  const regionCounts = {};
  allEvents.forEach((e) => {
    const r = e.event_region || "(null)";
    regionCounts[r] = (regionCounts[r] || 0) + 1;
  });
  console.log("\nRegion distribution:");
  Object.entries(regionCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([r, c]) => console.log(`  ${r}: ${c}`));

  // Filter US events
  const usEvents = allEvents.filter(isUSEvent);
  console.log(`\nUS events: ${usEvents.length}`);

  const today = new Date().toISOString().split("T")[0];
  const minStartDate = new Date(
    Date.now() + UPCOMING_MIN_DAYS_OUT * 86400000
  )
    .toISOString()
    .split("T")[0];
  const maxCreatedAt = new Date(
    Date.now() - UPCOMING_CONTACT_AGE_DAYS * 86400000
  )
    .toISOString()
    .split("T")[0];

  if (mode === "upcoming" || mode === "both") {
    const qualifying = usEvents.filter(
      (e) =>
        e.event_start_date &&
        e.event_start_date >= minStartDate &&
        e.contacts_with_email >= UPCOMING_MIN_CONTACTS
    );

    console.log(`\n${"=".repeat(50)}`);
    console.log("UPCOMING EVENTS");
    console.log(`${"=".repeat(50)}`);
    console.log(
      `Filters: start_date >= ${minStartDate}, contacts_with_email >= ${UPCOMING_MIN_CONTACTS}`
    );
    console.log(`Qualifying events: ${qualifying.length}`);
    qualifying.forEach((e) =>
      console.log(
        `  - ${e.event_name} | ${e.event_start_date} | ${e.contacts_with_email} contacts`
      )
    );

    if (qualifying.length > 0) {
      await extractAndSave(qualifying, "upcoming", maxCreatedAt);
    } else {
      console.log("No qualifying upcoming US events.");
    }
  }

  if (mode === "past" || mode === "both") {
    const qualifying = usEvents.filter(
      (e) =>
        e.event_start_date &&
        e.event_start_date < today &&
        e.contacts_with_email >= PAST_MIN_CONTACTS
    );

    console.log(`\n${"=".repeat(50)}`);
    console.log("PAST EVENTS");
    console.log(`${"=".repeat(50)}`);
    console.log(
      `Filters: start_date < ${today}, contacts_with_email >= ${PAST_MIN_CONTACTS}`
    );
    console.log(`Qualifying events: ${qualifying.length}`);
    qualifying.forEach((e) =>
      console.log(
        `  - ${e.event_name} | ${e.event_start_date} | ${e.contacts_with_email} contacts`
      )
    );

    if (qualifying.length > 0) {
      await extractAndSave(qualifying, "past", null);
    } else {
      console.log("No qualifying past US events.");
    }
  }
}

async function extractAndSave(events, type, maxContactCreatedAt) {
  const eventIds = events.map((e) => e.event_id);
  const eventMap = Object.fromEntries(events.map((e) => [e.event_id, e]));

  // Load previously exported emails (for upcoming dedup across runs)
  const trackingFile = join(__dirname, `exported-${type}-emails.json`);
  let previouslyExported = new Set();
  if (type === "upcoming" && existsSync(trackingFile)) {
    const data = JSON.parse(readFileSync(trackingFile, "utf-8"));
    previouslyExported = new Set(data);
    console.log(
      `\nLoaded ${previouslyExported.size} previously exported emails for dedup`
    );
  }

  // 1. Fetch contact_events for qualifying events
  console.log("\nFetching contact-event associations...");
  const contactEvents = await fetchByIds(
    "contact_events",
    "event_id",
    eventIds,
    "contact_id, event_id, post_id"
  );
  console.log(`  Found ${contactEvents.length} contact-event pairs`);

  // 2. Get unique contact IDs
  const contactIds = [...new Set(contactEvents.map((ce) => ce.contact_id))];
  console.log(`  Unique contacts: ${contactIds.length}`);

  // 3. Fetch contacts
  console.log("Fetching contact details...");
  const contacts = await fetchByIds(
    "contacts",
    "id",
    contactIds,
    "id, first_name, last_name, current_title, created_at, current_company_id"
  );
  const contactMap = Object.fromEntries(contacts.map((c) => [c.id, c]));

  // 4. Fetch primary valid emails
  console.log("Fetching emails...");
  const allEmails = await fetchByIds(
    "contact_emails",
    "contact_id",
    contactIds,
    "contact_id, email, status, is_primary"
  );
  // Keep only primary emails that have an address
  const emailMap = {};
  for (const e of allEmails) {
    if (e.is_primary && e.email && e.email.trim()) {
      emailMap[e.contact_id] = e.email.trim();
    }
  }

  // 5. Fetch companies
  const companyIds = [
    ...new Set(contacts.map((c) => c.current_company_id).filter(Boolean)),
  ];
  console.log("Fetching companies...");
  const companies = await fetchByIds("companies", "id", companyIds, "id, name");
  const companyMap = Object.fromEntries(companies.map((c) => [c.id, c.name]));

  // 6. Fetch posts (for post URLs)
  const postIds = [
    ...new Set(contactEvents.map((ce) => ce.post_id).filter(Boolean)),
  ];
  console.log("Fetching posts...");
  const posts = await fetchByIds("posts", "id", postIds, "id, post_url");
  const postMap = Object.fromEntries(posts.map((p) => [p.id, p.post_url]));

  // 7. Build rows — dedup by email, apply filters
  console.log("Building CSV...");

  // Sort: upcoming = soonest event first; past = most recent event first
  const sorted = [...contactEvents].sort((a, b) => {
    const ea = eventMap[a.event_id];
    const eb = eventMap[b.event_id];
    if (!ea?.event_start_date || !eb?.event_start_date) return 0;
    return type === "upcoming"
      ? ea.event_start_date.localeCompare(eb.event_start_date)
      : eb.event_start_date.localeCompare(ea.event_start_date);
  });

  const seen = new Set();
  const rows = [];
  let skipped = { noEmail: 0, noName: 0, personal: 0, tooNew: 0, dedup: 0, prevExported: 0 };

  for (const ce of sorted) {
    const contact = contactMap[ce.contact_id];
    if (!contact) continue;

    const email = emailMap[ce.contact_id];
    if (!email) { skipped.noEmail++; continue; }
    if (!contact.first_name?.trim()) { skipped.noName++; continue; }
    if (isPersonalEmail(email)) { skipped.personal++; continue; }

    // For upcoming: only contacts created 7+ days ago
    if (maxContactCreatedAt && contact.created_at) {
      const createdDate = contact.created_at.split("T")[0];
      if (createdDate > maxContactCreatedAt) { skipped.tooNew++; continue; }
    }

    const emailLower = email.toLowerCase();
    if (seen.has(emailLower)) { skipped.dedup++; continue; }
    if (previouslyExported.has(emailLower)) { skipped.prevExported++; continue; }
    seen.add(emailLower);

    const event = eventMap[ce.event_id];
    rows.push({
      email,
      first_name: contact.first_name.trim(),
      last_name: (contact.last_name || "").trim(),
      companyName: companyMap[contact.current_company_id] || "",
      eventName: event?.event_name || "",
      contactCount: String(event?.contacts_with_email || 0),
      postUrl: postMap[ce.post_id] || "",
    });
  }

  console.log("\nFilter stats:");
  console.log(`  No email: ${skipped.noEmail}`);
  console.log(`  No first name: ${skipped.noName}`);
  console.log(`  Personal email: ${skipped.personal}`);
  if (maxContactCreatedAt) console.log(`  Too new (<7 days): ${skipped.tooNew}`);
  console.log(`  Duplicate email: ${skipped.dedup}`);
  if (previouslyExported.size > 0) console.log(`  Previously exported: ${skipped.prevExported}`);

  // 8. Write CSV
  const outputDir = join(__dirname, "output");
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const date = new Date().toISOString().split("T")[0];
  const filename = `${type}-leads-${date}.csv`;
  const filepath = join(outputDir, filename);

  const headers = [
    "email",
    "first_name",
    "last_name",
    "companyName",
    "eventName",
    "contactCount",
    "postUrl",
  ];
  writeFileSync(filepath, toCsv(rows, headers));
  console.log(`\nExported ${rows.length} contacts to ${filepath}`);

  // 9. Update tracking file (for upcoming daily dedup)
  if (type === "upcoming") {
    const newEmails = rows.map((r) => r.email.toLowerCase());
    const merged = [...new Set([...previouslyExported, ...newEmails])];
    writeFileSync(trackingFile, JSON.stringify(merged, null, 2));
    console.log(`Tracking file updated: ${merged.length} total exported emails`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
