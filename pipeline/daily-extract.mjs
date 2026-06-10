/**
 * WhoGoes Daily Lead Extraction Pipeline
 *
 * Fetches qualifying event contacts from Supabase, generates personalization
 * via Gemini, appends to Google Sheets (US/EU/APAC tabs), sends Slack summary.
 *
 * Usage:
 *   node pipeline/daily-extract.mjs              # Full run
 *   node pipeline/daily-extract.mjs --dry-run    # Preview only (no Sheet/Slack/state updates)
 *   node pipeline/daily-extract.mjs --limit=5    # Limit total contacts (for testing)
 *   node pipeline/daily-extract.mjs --backfill   # Re-process all events, dedup against sheet
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createPipelineClient } from "./lib/supabase.mjs";
import { getQualifyingEvents, updatePipelineState } from "./lib/events.mjs";
import { fetchContactsForEvent } from "./lib/contacts.mjs";
import { appendToSheet, getExistingEmails } from "./lib/sheets.mjs";
import { sendSlackNotification } from "./lib/slack.mjs";
import { normalizeEventName } from "./lib/utils.mjs";

function getTimingBucket(startDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDate = new Date(startDate);
  eventDate.setHours(0, 0, 0, 0);
  const daysOut = Math.round((eventDate - today) / (1000 * 60 * 60 * 24));
  if (daysOut <= 7)  return "this_week";
  if (daysOut <= 14) return "urgent";
  return "early";
}


const DRY_RUN = process.argv.includes("--dry-run");
const BACKFILL = process.argv.includes("--backfill");
const LIMIT = (() => {
  const flag = process.argv.find((a) => a.startsWith("--limit="));
  return flag ? parseInt(flag.split("=")[1], 10) : 0;
})();
const REGION_FILTER = (() => {
  const flag = process.argv.find((a) => a.startsWith("--region="));
  return flag ? flag.split("=")[1].toUpperCase() : null;
})();

// Daily per-region limits (overridden by --limit for testing)
const REGION_DAILY_LIMITS = { US: 1000, EU: 1200 };

async function main() {
  const startTime = Date.now();

  if (DRY_RUN) console.log("=== DRY RUN MODE (no Sheet/Slack/state updates) ===\n");
  if (BACKFILL) console.log("=== BACKFILL MODE: re-process all events as INIT, dedup against sheet ===\n");
  if (REGION_FILTER) console.log(`=== REGION FILTER: ${REGION_FILTER} only ===\n`);
  if (LIMIT) console.log(`=== LIMIT MODE: max ${LIMIT} contacts total (overrides region limits) ===\n`);
  else console.log(`=== REGION LIMITS: US=${REGION_DAILY_LIMITS.US} EU=${REGION_DAILY_LIMITS.EU} ===\n`);

  // Validate required env vars
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}`);
    }
  }

  const supabase = createPipelineClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Build sheet config once (if creds available)
  const hasSheetCreds = process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_CLIENT_ID
    && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN;
  const sheetConfig = hasSheetCreds ? {
    sheetId: process.env.GOOGLE_SHEET_ID,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
  } : null;

  // Step 1: Get qualifying events
  console.log("Step 1: Fetching qualifying events...");
  const events = await getQualifyingEvents(supabase);

  if (events.length === 0) {
    console.log("No qualifying events found. Done.");
    return;
  }

  // In backfill mode, force all events to INIT (re-fetch all contacts)
  if (BACKFILL) {
    for (const e of events) {
      e.isInit = true;
      e.lastContactCreatedAt = null;
    }
  }

  const newEvents = events.filter((e) => e.isInit);
  const incrementalEvents = events.filter((e) => !e.isInit);
  console.log(`  ${newEvents.length} new events, ${incrementalEvents.length} incremental\n`);

  // Log event breakdown
  for (const e of events) {
    console.log(`  [${e.region}] ${e.event_name} — ${e.contacts_with_email} contacts — ${e.isInit ? "INIT" : "INCREMENTAL"}`);
  }
  console.log();

  // In backfill mode, load existing emails from sheet for dedup
  let existingSheetEmails = null;
  if (BACKFILL && sheetConfig) {
    console.log("Loading existing emails from Google Sheet for dedup...");
    const [usEmails, euEmails, apacEmails] = await Promise.all([
      getExistingEmails("US", sheetConfig),
      getExistingEmails("EU", sheetConfig),
      getExistingEmails("APAC", sheetConfig),
    ]);
    existingSheetEmails = new Set([...usEmails, ...euEmails, ...apacEmails]);
    console.log(`  ${existingSheetEmails.size} emails already in sheet\n`);
  }

  // Step 2: Process each event (fetch → personalize → write to sheet → update state)
  const regionCounts = { US: 0, EU: 0, APAC: 0 };
  const errors = [];
  const processedNewEvents = [];
  let totalCollected = 0;

  for (const event of events) {
    // Stop early if global test limit hit
    if (LIMIT && totalCollected >= LIMIT) break;

    // Skip if region filter is active and this event doesn't match
    if (REGION_FILTER && event.region !== REGION_FILTER) continue;

    // Skip if this region has hit its daily limit
    if (!LIMIT) {
      const regionLimit = REGION_DAILY_LIMITS[event.region];
      if (regionLimit && regionCounts[event.region] >= regionLimit) {
        console.log(`  Skipping ${event.event_name} [${event.region}] — daily limit of ${regionLimit} reached`);
        continue;
      }
    }

    try {
      console.log(`Processing: ${event.event_name} [${event.region}] (${event.isInit ? "INIT" : "INCR"})...`);

      // Fetch contacts (init = all, incremental = new only)
      let contacts = await fetchContactsForEvent(supabase, event);
      console.log(`    Usable contacts: ${contacts.length}`);

      // In backfill mode, filter out contacts already in the sheet
      if (BACKFILL && existingSheetEmails) {
        const before = contacts.length;
        contacts = contacts.filter((c) => !existingSheetEmails.has(c.email.toLowerCase()));
        if (before !== contacts.length) {
          console.log(`    Backfill dedup: ${before - contacts.length} already in sheet, ${contacts.length} new`);
        }
      }

      // Trim to remaining capacity (--limit for testing, region limit for production)
      const remaining = LIMIT
        ? LIMIT - totalCollected
        : (REGION_DAILY_LIMITS[event.region] || Infinity) - regionCounts[event.region];
      if (contacts.length > remaining) {
        contacts = contacts.slice(0, remaining);
        console.log(`    Trimmed to ${contacts.length} (remaining capacity for ${event.region})`);
      }

      if (contacts.length === 0) {
        console.log(`    Skipping (no new contacts)\n`);
        continue;
      }

      // Inject event metadata onto each contact
      const timing = getTimingBucket(event.event_start_date);
      const eventName = normalizeEventName(event.event_name);
      const enriched = contacts.map((c) => ({
        ...c,
        eventName,
        eventDate: event.event_start_date,
        contactCount: event.contacts_with_email,
        timing,
      }));

      // Write to Google Sheet immediately (per-event, not batched at end)
      if (!DRY_RUN && sheetConfig) {
        try {
          const count = await appendToSheet(enriched, event.region, sheetConfig);
          regionCounts[event.region] += count;
          console.log(`    Sheet: ${count} rows → ${event.region} tab`);
        } catch (err) {
          console.error(`    Sheet append failed: ${err.message}`);
          errors.push(`GSheet ${event.event_name}: ${err.message}`);
        }
      } else if (DRY_RUN) {
        regionCounts[event.region] += enriched.length;
        for (const c of enriched.slice(0, 2)) {
          console.log(`    ${c.firstName} ${c.lastName} <${c.email}> [${c.timing}]`);
        }
        if (enriched.length > 2) {
          console.log(`    ... and ${enriched.length - 2} more`);
        }
      } else {
        regionCounts[event.region] += enriched.length;
      }

      totalCollected += enriched.length;

      // Track new events for Slack notification
      if (event.isInit) {
        processedNewEvents.push({
          name: event.event_name,
          contacts: enriched.length,
          region: event.region,
        });
      }

      // Update pipeline_state watermark
      if (!DRY_RUN) {
        const maxCreatedAt = enriched.reduce(
          (max, c) => (c.createdAt > max ? c.createdAt : max),
          enriched[0].createdAt
        );
        await updatePipelineState(
          supabase, event.event_id, enriched.length, maxCreatedAt, event.previousTotal
        );
        console.log(`    State updated (watermark: ${maxCreatedAt})`);
      }

      console.log();
    } catch (err) {
      console.error(`  ERROR processing ${event.event_name}: ${err.message}\n`);
      errors.push(`${event.event_name}: ${err.message}`);
    }
  }

  // Summary
  const duration = Math.round((Date.now() - startTime) / 1000);
  const total = regionCounts.US + regionCounts.EU + regionCounts.APAC;

  console.log(`\n${"=".repeat(50)}`);
  console.log(`SUMMARY`);
  console.log(`${"=".repeat(50)}`);
  console.log(`Duration: ${duration}s`);
  console.log(`New events: ${processedNewEvents.length}`);
  processedNewEvents.forEach((e) => console.log(`  - ${e.name} [${e.region}]: ${e.contacts} contacts`));
  console.log(`Contacts: US=${regionCounts.US} EU=${regionCounts.EU} APAC=${regionCounts.APAC} Total=${total}`);
  if (errors.length > 0) {
    console.log(`Errors: ${errors.length}`);
    errors.forEach((e) => console.log(`  - ${e}`));
  }

  // Send Slack notification
  if (!DRY_RUN) {
    await sendSlackNotification(
      {
        duration,
        newEvents: processedNewEvents,
        regions: regionCounts,
        errors,
      },
      process.env.SLACK_WEBHOOK_URL
    );
  } else {
    console.log("\n[DRY RUN] Slack notification skipped");
  }

  console.log(`\nDone in ${duration}s`);
}

main().catch(async (err) => {
  console.error("Pipeline failed:", err);

  // Try to send error notification to Slack
  if (!DRY_RUN && process.env.SLACK_WEBHOOK_URL) {
    try {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `Daily Lead Extract FAILED\n${err.message}`,
        }),
      });
    } catch (_) {}
  }

  process.exit(1);
});
