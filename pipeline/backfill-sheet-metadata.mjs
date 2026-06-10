/**
 * Backfill Event Date + Contact Count for existing sheet rows.
 *
 * Existing rows were written in the old format:
 *   A: First Name | B: Last Name | C: Email | D: Personalization | E: Event Name
 *
 * This script rewrites them to the new format:
 *   A: First Name | B: Last Name | C: Email | D: Event Name | E: Event Date | F: Contact Count
 *
 * Usage:
 *   node pipeline/backfill-sheet-metadata.mjs
 *   node pipeline/backfill-sheet-metadata.mjs --dry-run   # Preview only
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *                    GOOGLE_SHEET_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 */

import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");

function getTimingBucket(startDate) {
  if (!startDate) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDate = new Date(startDate);
  eventDate.setHours(0, 0, 0, 0);
  const daysOut = Math.round((eventDate - today) / (1000 * 60 * 60 * 24));
  if (daysOut <= 7)  return "this_week";
  if (daysOut <= 14) return "urgent";
  return "early";
}
const TAB_FLAG = process.argv.find((a) => a.startsWith("--tab="))?.split("=")[1];
const LIMIT_FLAG = parseInt(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0", 10);
const TABS = TAB_FLAG ? [TAB_FLAG.toUpperCase()] : ["US", "EU", "APAC"];

function getAuthClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

async function readTab(sheets, sheetId, tab) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tab}!A2:F`,
  });
  return res.data.values || [];
}

async function getEventMetadata(supabase, eventNames) {
  const { data, error } = await supabase
    .from("events")
    .select("id, name, start_date")
    .in("name", eventNames);

  if (error) throw new Error(`events query failed: ${error.message}`);

  const eventMap = {};
  for (const e of data || []) {
    eventMap[e.name] = { eventId: e.id, startDate: e.start_date };
  }

  // Fetch contact counts per event
  const eventIds = (data || []).map((e) => e.id);
  if (eventIds.length === 0) return eventMap;

  const { data: counts, error: countErr } = await supabase
    .from("contact_events")
    .select("event_id")
    .in("event_id", eventIds);

  if (countErr) throw new Error(`contact_events query failed: ${countErr.message}`);

  const countMap = {};
  for (const row of counts || []) {
    countMap[row.event_id] = (countMap[row.event_id] || 0) + 1;
  }

  for (const e of data || []) {
    eventMap[e.name].contactCount = countMap[e.id] || 0;
  }

  return eventMap;
}

async function main() {
  if (DRY_RUN) console.log("=== DRY RUN MODE (no writes) ===\n");

  const required = [
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "GOOGLE_SHEET_ID", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN",
  ];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });
  const sheetId = process.env.GOOGLE_SHEET_ID;

  for (const tab of TABS) {
    console.log(`\nProcessing tab: ${tab}`);
    const rows = await readTab(sheets, sheetId, tab);

    if (rows.length === 0) {
      console.log(`  No data rows found, skipping.`);
      continue;
    }

    console.log(`  ${rows.length} rows found${LIMIT_FLAG ? `, processing first ${LIMIT_FLAG}` : ""}`);

    // Detect format: old format has 5 cols (Personalization in D, Event Name in E)
    // New format has 6 cols (Event Name in D). Detect by whether col D looks like a
    // long personalization string (>80 chars) vs a short event name.
    const sampleD = (rows[0][3] || "").trim();
    const isOldFormat = sampleD.length > 80;

    if (isOldFormat) {
      console.log(`  Detected OLD format (Personalization in col D, Event Name in col E)`);
    } else {
      console.log(`  Detected NEW format (Event Name in col D) — will only fill missing Event Date/Count`);
    }

    // Apply row limit if specified
    const targetRows = LIMIT_FLAG ? rows.slice(0, LIMIT_FLAG) : rows;

    // Collect unique event names
    const eventNameIndex = isOldFormat ? 4 : 3;
    const eventNames = [...new Set(targetRows.map((r) => (r[eventNameIndex] || "").trim()).filter(Boolean))];
    console.log(`  Unique events: ${eventNames.join(", ")}`);

    // Look up event metadata from Supabase
    const eventMap = await getEventMetadata(supabase, eventNames);
    const missing = eventNames.filter((n) => !eventMap[n]);
    if (missing.length > 0) {
      console.log(`  WARNING: no Supabase match for: ${missing.join(", ")}`);
    }

    // Build updated rows in new format
    const updatedRows = targetRows.map((r) => {
      const firstName   = r[0] || "";
      const lastName    = r[1] || "";
      const email       = r[2] || "";
      const eventName   = isOldFormat ? (r[4] || "").trim() : (r[3] || "").trim();
      const meta        = eventMap[eventName] || {};
      const eventDate    = meta.startDate || "";
      const contactCount = meta.contactCount != null ? String(meta.contactCount) : "";
      const timing       = getTimingBucket(eventDate);

      return [firstName, lastName, email, eventName, eventDate, contactCount, timing];
    });

    if (DRY_RUN) {
      console.log(`  Sample updated rows:`);
      for (const r of updatedRows.slice(0, 3)) {
        console.log(`    ${r.join(" | ")}`);
      }
      continue;
    }

    // Overwrite target rows in the tab (row 2 onwards)
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tab}!A2:G${updatedRows.length + 1}`,
      valueInputOption: "RAW",
      requestBody: { values: updatedRows },
    });

    console.log(`  Written ${updatedRows.length} rows to ${tab} tab`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
