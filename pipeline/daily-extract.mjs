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
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createPipelineClient } from "./lib/supabase.mjs";
import { getQualifyingEvents, updatePipelineState } from "./lib/events.mjs";
import { fetchContactsForEvent } from "./lib/contacts.mjs";
import { personalizeContacts } from "./lib/personalize.mjs";
import { appendToSheet } from "./lib/sheets.mjs";
import { sendSlackNotification } from "./lib/slack.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT = (() => {
  const flag = process.argv.find((a) => a.startsWith("--limit="));
  return flag ? parseInt(flag.split("=")[1], 10) : 0;
})();

async function main() {
  const startTime = Date.now();

  if (DRY_RUN) console.log("=== DRY RUN MODE (no Sheet/Slack/state updates) ===\n");
  if (LIMIT) console.log(`=== LIMIT MODE: max ${LIMIT} contacts total ===\n`);

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

  // Step 1: Get qualifying events
  console.log("Step 1: Fetching qualifying events...");
  const events = await getQualifyingEvents(supabase);

  if (events.length === 0) {
    console.log("No qualifying events found. Done.");
    return;
  }

  const newEvents = events.filter((e) => e.isInit);
  const incrementalEvents = events.filter((e) => !e.isInit);
  console.log(`  ${newEvents.length} new events, ${incrementalEvents.length} incremental\n`);

  // Log event breakdown
  for (const e of events) {
    console.log(`  [${e.region}] ${e.event_name} — ${e.contacts_with_email} contacts — ${e.isInit ? "INIT" : "INCREMENTAL"}`);
  }
  console.log();

  // Step 2: Process each event
  const allContacts = { US: [], EU: [], APAC: [] };
  const errors = [];
  const processedNewEvents = [];
  let totalCollected = 0;

  for (const event of events) {
    // Stop early if we hit the limit
    if (LIMIT && totalCollected >= LIMIT) break;

    try {
      console.log(`Processing: ${event.event_name} [${event.region}] (${event.isInit ? "INIT" : "INCR"})...`);

      // Fetch contacts (init = all, incremental = new only)
      let contacts = await fetchContactsForEvent(supabase, event);
      console.log(`    Usable contacts: ${contacts.length}`);

      // Trim to remaining limit
      if (LIMIT) {
        const remaining = LIMIT - totalCollected;
        if (contacts.length > remaining) {
          contacts = contacts.slice(0, remaining);
          console.log(`    Trimmed to ${contacts.length} (--limit=${LIMIT})`);
        }
      }

      if (contacts.length === 0) {
        console.log(`    Skipping (no new contacts)\n`);
        continue;
      }

      // Generate personalization via Gemini
      console.log(`    Generating personalization...`);
      const personalized = await personalizeContacts(contacts, process.env.GEMINI_API_KEY);

      // Add to the correct region bucket
      allContacts[event.region].push(...personalized);
      totalCollected += personalized.length;

      // Track new events for Slack notification
      if (event.isInit) {
        processedNewEvents.push({
          name: event.event_name,
          contacts: contacts.length,
          region: event.region,
        });
      }

      // Update pipeline_state watermark
      if (!DRY_RUN) {
        const maxCreatedAt = contacts.reduce(
          (max, c) => (c.createdAt > max ? c.createdAt : max),
          contacts[0].createdAt
        );
        await updatePipelineState(
          supabase, event.event_id, contacts.length, maxCreatedAt, event.previousTotal
        );
        console.log(`    State updated (watermark: ${maxCreatedAt})`);
      }

      console.log();
    } catch (err) {
      console.error(`  ERROR processing ${event.event_name}: ${err.message}\n`);
      errors.push(`${event.event_name}: ${err.message}`);
    }
  }

  // Step 3: Append to Google Sheets
  const regionCounts = { US: 0, EU: 0, APAC: 0 };

  const hasSheetCreds = process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_CLIENT_ID
    && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN;

  if (!DRY_RUN && hasSheetCreds) {
    console.log("Step 3: Appending to Google Sheets...");
    const sheetConfig = {
      sheetId: process.env.GOOGLE_SHEET_ID,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    };

    for (const region of ["US", "EU", "APAC"]) {
      if (allContacts[region].length > 0) {
        try {
          const count = await appendToSheet(allContacts[region], region, sheetConfig);
          regionCounts[region] = count;
          console.log(`  ${region}: ${count} rows appended`);
        } catch (err) {
          console.error(`  ${region} Sheet append failed: ${err.message}`);
          errors.push(`GSheet ${region}: ${err.message}`);
        }
      }
    }
  } else if (DRY_RUN) {
    console.log("Step 3: [DRY RUN] Would append to Google Sheets:");
    for (const region of ["US", "EU", "APAC"]) {
      regionCounts[region] = allContacts[region].length;
      console.log(`  ${region}: ${allContacts[region].length} contacts`);
      // Show first 3 contacts per region as preview
      for (const c of allContacts[region].slice(0, 3)) {
        console.log(`    ${c.firstName} ${c.lastName} <${c.email}> — ${c.eventName}`);
        console.log(`      Personalization: ${c.personalization}`);
      }
      if (allContacts[region].length > 3) {
        console.log(`    ... and ${allContacts[region].length - 3} more`);
      }
    }
  } else {
    console.log("Step 3: Skipped (missing Google Sheets credentials)");
    for (const region of ["US", "EU", "APAC"]) {
      regionCounts[region] = allContacts[region].length;
    }
  }

  // Step 4: Send Slack notification
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
          text: `:red_circle: *Daily Lead Extract FAILED*\n${err.message}`,
        }),
      });
    } catch (_) {}
  }

  process.exit(1);
});
