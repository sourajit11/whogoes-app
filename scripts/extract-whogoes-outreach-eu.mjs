/**
 * WhoGoes Outreach Lead Extraction
 *
 * Extracts contacts for WhoGoes cold outreach campaign.
 * Filters: US events, 100+ attendees with email, contacts created Mar 16-22,
 * auto-selects exhibitor per event for social proof.
 *
 * Usage:
 *   node app/scripts/extract-whogoes-outreach.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://citrznhubxqvsfhjkssg.supabase.co";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpdHJ6bmh1YnhxdnNmaGprc3NnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTMxMjkxMiwiZXhwIjoyMDg2ODg4OTEyfQ.CT7QMc5evdt5lBvOXSe4ZHbOdpZUrYMqN9VB--efbWg";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// --- Config ---
const DATE_FROM = "2026-03-16";
const DATE_TO = "2026-03-22";
const MIN_CONTACTS_WITH_EMAIL = 100;

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "mail.com", "protonmail.com", "zoho.com", "yandex.com",
  "live.com", "msn.com", "me.com", "qq.com", "163.com", "gmx.com",
  "yahoo.co.in", "rediffmail.com", "inbox.com", "fastmail.com",
]);

function isEUEvent(event) {
  const region = (event.event_region || "").toLowerCase();
  const location = (event.event_location || "").toLowerCase();
  const patterns = [
    "eu", "emea", "europe", "uk", "united kingdom", "great britain",
    "germany", "france", "spain", "italy", "netherlands", "belgium",
    "austria", "switzerland", "sweden", "norway", "denmark", "finland",
    "poland", "portugal", "ireland", "czech", "hungary", "romania",
    "greece", "croatia", "slovakia", "slovenia", "bulgaria", "estonia",
    "latvia", "lithuania", "luxembourg", "malta", "cyprus",
  ];
  return patterns.some((p) => region.includes(p) || location.includes(p));
}

function isPersonalEmail(email) {
  const domain = email.split("@")[1]?.toLowerCase();
  return PERSONAL_DOMAINS.has(domain);
}

async function fetchAll(table, query, selectCols = "*", pageSize = 1000) {
  const results = [];
  let start = 0;
  while (true) {
    let q = supabase
      .from(table)
      .select(selectCols)
      .range(start, start + pageSize - 1);

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

async function fetchByIds(table, column, ids, selectCols = "*") {
  if (ids.length === 0) return [];
  const BATCH = 100;
  const results = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
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

async function main() {
  // Step 1: Fetch all events with contact counts
  console.log("Fetching all events via get_all_browsable_events...");
  const { data: allEvents, error } = await supabase.rpc("get_all_browsable_events");
  if (error) throw new Error(`RPC failed: ${error.message}`);
  console.log(`Total events: ${allEvents.length}`);

  // Step 2: Filter to US events with 100+ contacts with email, starting 10+ days from now
  const minStartDate = new Date(Date.now() + 10 * 86400000).toISOString().split("T")[0];
  const qualifying = allEvents.filter(
    (e) =>
      isEUEvent(e) &&
      e.contacts_with_email >= MIN_CONTACTS_WITH_EMAIL &&
      e.event_start_date &&
      e.event_start_date >= minStartDate
  );
  console.log(`EU/EMEA events with ${MIN_CONTACTS_WITH_EMAIL}+ email contacts: ${qualifying.length}`);
  qualifying.forEach((e) =>
    console.log(`  - ${e.event_name} | ${e.event_start_date} | ${e.contacts_with_email} contacts`)
  );

  if (qualifying.length === 0) {
    console.log("No qualifying events found.");
    return;
  }

  const eventIds = qualifying.map((e) => e.event_id);
  const eventMap = Object.fromEntries(qualifying.map((e) => [e.event_id, e]));

  // Step 3: Fetch contact_events for qualifying events
  console.log("\nFetching contact-event associations...");
  const contactEvents = await fetchByIds(
    "contact_events", "event_id", eventIds,
    "contact_id, event_id, post_id"
  );
  console.log(`  Found ${contactEvents.length} contact-event pairs`);

  // Step 4: Get unique contact IDs
  const contactIds = [...new Set(contactEvents.map((ce) => ce.contact_id))];
  console.log(`  Unique contacts: ${contactIds.length}`);

  // Step 5: Fetch contacts — filter by created_at between Mar 16-22
  console.log(`Fetching contacts created between ${DATE_FROM} and ${DATE_TO}...`);
  const allContacts = await fetchByIds(
    "contacts", "id", contactIds,
    "id, first_name, last_name, current_title, created_at, current_company_id"
  );

  // Filter by date range
  const contacts = allContacts.filter((c) => {
    if (!c.created_at) return false;
    const d = c.created_at.split("T")[0];
    return d >= DATE_FROM && d <= DATE_TO;
  });
  console.log(`  Contacts in date range: ${contacts.length} (out of ${allContacts.length} total)`);

  const contactMap = Object.fromEntries(contacts.map((c) => [c.id, c]));
  const dateFilteredContactIds = new Set(contacts.map((c) => c.id));

  // Step 6: Fetch primary emails for date-filtered contacts
  const filteredContactIds = [...dateFilteredContactIds];
  console.log("Fetching emails...");
  const allEmails = await fetchByIds(
    "contact_emails", "contact_id", filteredContactIds,
    "contact_id, email, status, is_primary"
  );
  const emailMap = {};
  for (const e of allEmails) {
    if (e.is_primary && e.email && e.email.trim()) {
      emailMap[e.contact_id] = e.email.trim();
    }
  }

  // Step 7: Fetch companies
  const companyIds = [...new Set(contacts.map((c) => c.current_company_id).filter(Boolean))];
  console.log("Fetching companies...");
  const companies = await fetchByIds("companies", "id", companyIds, "id, name");
  const companyMap = Object.fromEntries(companies.map((c) => [c.id, c.name]));

  // Step 8: Build exhibitor map — for each event, find the top 2 companies by contact count
  console.log("Computing exhibitors per event...");

  // Filter contact_events to only date-filtered contacts
  const relevantCEs = contactEvents.filter((ce) => dateFilteredContactIds.has(ce.contact_id));

  // Count contacts per company per event
  const eventCompanyCounts = {}; // { eventId: { companyName: count } }
  for (const ce of relevantCEs) {
    const contact = contactMap[ce.contact_id];
    if (!contact || !contact.current_company_id) continue;
    const companyName = companyMap[contact.current_company_id];
    if (!companyName) continue;

    if (!eventCompanyCounts[ce.event_id]) eventCompanyCounts[ce.event_id] = {};
    eventCompanyCounts[ce.event_id][companyName] =
      (eventCompanyCounts[ce.event_id][companyName] || 0) + 1;
  }

  // Pick top 2 companies per event
  const exhibitorMap = {}; // { eventId: { primary: string, fallback: string } }
  for (const [eventId, companyCounts] of Object.entries(eventCompanyCounts)) {
    const sorted = Object.entries(companyCounts)
      .sort((a, b) => b[1] - a[1]);

    const primary = sorted[0]?.[0] || "a top exhibitor";
    const fallback = sorted[1]?.[0] || sorted[0]?.[0] || "a top exhibitor";
    exhibitorMap[eventId] = { primary, fallback };
  }

  console.log("\nExhibitors per event:");
  for (const [eventId, { primary, fallback }] of Object.entries(exhibitorMap)) {
    const eventName = eventMap[eventId]?.event_name || eventId;
    console.log(`  ${eventName}: primary="${primary}", fallback="${fallback}"`);
  }

  // Step 9: Build CSV rows
  console.log("\nBuilding CSV...");
  const seen = new Set();
  const rows = [];
  let skipped = { noEmail: 0, noName: 0, personal: 0, dedup: 0, notInDateRange: 0 };

  for (const ce of contactEvents) {
    // Only contacts in date range
    if (!dateFilteredContactIds.has(ce.contact_id)) {
      skipped.notInDateRange++;
      continue;
    }

    const contact = contactMap[ce.contact_id];
    if (!contact) continue;

    const email = emailMap[ce.contact_id];
    if (!email) { skipped.noEmail++; continue; }
    if (!contact.first_name?.trim()) { skipped.noName++; continue; }
    if (isPersonalEmail(email)) { skipped.personal++; continue; }

    const emailLower = email.toLowerCase();
    if (seen.has(emailLower)) { skipped.dedup++; continue; }
    seen.add(emailLower);

    const event = eventMap[ce.event_id];
    const contactCompanyName = companyMap[contact.current_company_id] || "";

    // Exhibitor logic: if contact's company matches primary exhibitor, use fallback
    const exhibitors = exhibitorMap[ce.event_id] || { primary: "a top exhibitor", fallback: "a top exhibitor" };
    let exhibitor = exhibitors.primary;
    if (contactCompanyName && contactCompanyName.toLowerCase() === exhibitor.toLowerCase()) {
      exhibitor = exhibitors.fallback;
    }

    rows.push({
      email,
      first_name: contact.first_name.trim(),
      last_name: (contact.last_name || "").trim(),
      companyName: contactCompanyName,
      event: event?.event_name || "",
      count: String(event?.contacts_with_email || 0),
      exhibitor,
      Subject: `${event?.event_name || ""} meeting`,
    });
  }

  console.log("\nFilter stats:");
  console.log(`  Not in date range: ${skipped.notInDateRange}`);
  console.log(`  No email: ${skipped.noEmail}`);
  console.log(`  No first name: ${skipped.noName}`);
  console.log(`  Personal email: ${skipped.personal}`);
  console.log(`  Duplicate email: ${skipped.dedup}`);

  // Step 10: Write CSV
  const outputDir = join(__dirname, "output");
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const filename = `whogoes-outreach-eu-${DATE_FROM}-to-${DATE_TO}.csv`;
  const filepath = join(outputDir, filename);

  const headers = [
    "email", "first_name", "last_name", "companyName",
    "event", "count", "exhibitor", "Subject",
  ];
  writeFileSync(filepath, toCsv(rows, headers));

  console.log(`\nExported ${rows.length} contacts to ${filepath}`);

  // Summary by event
  const eventSummary = {};
  for (const row of rows) {
    if (!eventSummary[row.event]) eventSummary[row.event] = 0;
    eventSummary[row.event]++;
  }
  console.log("\nContacts per event:");
  Object.entries(eventSummary)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => console.log(`  ${name}: ${count}`));
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
