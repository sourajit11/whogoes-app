/**
 * WhoGoes Daily Bounce Extraction Pipeline
 *
 * Fetches bounced leads from Instantly across all campaigns,
 * deduplicates against existing Google Sheet entries, and appends new bounces.
 *
 * Usage:
 *   node pipeline/bounce-extract.mjs              # Full run
 *   node pipeline/bounce-extract.mjs --dry-run    # Preview only
 *
 * Required env vars: INSTANTLY_API_KEY
 * Optional env vars: BOUNCE_GOOGLE_SHEET_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
 *                    GOOGLE_REFRESH_TOKEN, SLACK_WEBHOOK_URL
 */

import { appendToBouncesSheet, getExistingBounceEmails } from "./lib/sheets.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const API_BASE = "https://api.instantly.ai/api/v2";

async function main() {
  const startTime = Date.now();

  if (DRY_RUN) console.log("=== DRY RUN MODE (no Sheet/Slack updates) ===\n");

  // Validate required env var
  if (!process.env.INSTANTLY_API_KEY) {
    throw new Error("Missing required env var: INSTANTLY_API_KEY");
  }

  const apiKey = process.env.INSTANTLY_API_KEY;

  // Build sheet config (if creds available)
  const hasSheetCreds =
    process.env.BOUNCE_GOOGLE_SHEET_ID &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN;

  const sheetConfig = hasSheetCreds
    ? {
        sheetId: process.env.BOUNCE_GOOGLE_SHEET_ID,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
      }
    : null;

  if (!sheetConfig) {
    console.log("Warning: Google Sheet creds missing. Will print to console only.\n");
  }

  // Step 1: Fetch campaign name lookup
  console.log("Step 1: Fetching campaigns...");
  const campaignMap = await fetchCampaignMap(apiKey);
  console.log(`  Found ${campaignMap.size} campaigns\n`);

  // Step 2: Fetch all bounced leads
  console.log("Step 2: Fetching bounced leads...");
  const bouncedLeads = await fetchAllBouncedLeads(apiKey);
  console.log(`  Total bounced leads: ${bouncedLeads.length}\n`);

  if (bouncedLeads.length === 0) {
    console.log("No bounced leads found. Done.");
    return;
  }

  // Step 3: Dedup against existing sheet entries
  let newBounces = bouncedLeads;
  let existingCount = 0;

  if (sheetConfig && !DRY_RUN) {
    console.log("Step 3: Loading existing bounce emails from sheet...");
    try {
      const existing = await getExistingBounceEmails(sheetConfig);
      existingCount = existing.size;
      console.log(`  ${existingCount} emails already in sheet`);
      newBounces = bouncedLeads.filter(
        (lead) => !existing.has(lead.email.trim().toLowerCase())
      );
      console.log(`  ${newBounces.length} new bounces to add\n`);
    } catch (err) {
      // If the tab doesn't exist yet, treat as empty
      if (err.message?.includes("Unable to parse range")) {
        console.log("  Bounces tab not found or empty, treating as first run\n");
      } else {
        throw err;
      }
    }
  }

  // Step 4: Map to sheet rows
  const rows = newBounces.map((lead) => [
    lead.email,
    lead.first_name || "",
    lead.last_name || "",
    campaignMap.get(lead.campaign) || lead.campaign || "",
    lead.company_name || "",
    lead.company_domain || "",
    lead.status_summary?.lastStep?.timestamp_executed
      ? new Date(lead.status_summary.lastStep.timestamp_executed)
          .toISOString()
          .split("T")[0]
      : "",
  ]);

  // Step 5: Write to sheet or print
  if (rows.length === 0) {
    console.log("No new bounces to add.");
  } else if (!DRY_RUN && sheetConfig) {
    console.log("Step 4: Appending to Google Sheet...");
    const count = await appendToBouncesSheet(rows, sheetConfig);
    console.log(`  Wrote ${count} rows to Bounces tab`);
  } else {
    console.log(`New bounces (${rows.length}):`);
    for (const row of rows.slice(0, 10)) {
      console.log(`  ${row[0]} — ${row[3]} — ${row[6]}`);
    }
    if (rows.length > 10) console.log(`  ... and ${rows.length - 10} more`);
  }

  // Summary
  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n${"=".repeat(50)}`);
  console.log("SUMMARY");
  console.log("=".repeat(50));
  console.log(`Duration: ${duration}s`);
  console.log(`Total bounced leads in Instantly: ${bouncedLeads.length}`);
  console.log(`Already in sheet: ${existingCount}`);
  console.log(`New bounces added: ${rows.length}`);

  // Send Slack notification
  if (!DRY_RUN && process.env.SLACK_WEBHOOK_URL && rows.length > 0) {
    await sendBounceSlackNotification({
      duration,
      newCount: rows.length,
      totalCount: bouncedLeads.length,
      samples: rows.slice(0, 5).map((r) => `${r[0]} (${r[3]})`),
    });
  } else if (!DRY_RUN && process.env.SLACK_WEBHOOK_URL && rows.length === 0) {
    // Still send a brief "all clear" message
    await sendBounceSlackNotification({
      duration,
      newCount: 0,
      totalCount: bouncedLeads.length,
      samples: [],
    });
  }

  console.log(`\nDone in ${duration}s`);
}

/**
 * Fetch all campaigns and return a Map of id → name.
 */
async function fetchCampaignMap(apiKey) {
  const map = new Map();
  let cursor = null;

  do {
    const url = new URL(`${API_BASE}/campaigns`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("starting_after", cursor);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`Campaigns API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    for (const campaign of data.items || []) {
      map.set(campaign.id, campaign.name);
    }
    cursor = data.next_starting_after || null;
  } while (cursor);

  return map;
}

/**
 * Fetch all bounced leads across all campaigns with pagination.
 */
async function fetchAllBouncedLeads(apiKey) {
  const leads = [];
  let cursor = null;

  do {
    const body = {
      filter: "FILTER_VAL_BOUNCED",
      limit: 100,
    };
    if (cursor) body.starting_after = cursor;

    const res = await fetch(`${API_BASE}/leads/list`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Leads API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    leads.push(...(data.items || []));
    cursor = data.next_starting_after || null;

    console.log(`    Fetched ${leads.length} bounced leads so far...`);
  } while (cursor);

  return leads;
}

/**
 * Send Slack notification about bounce extraction results.
 */
async function sendBounceSlackNotification(summary) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const sampleLines =
    summary.samples.length > 0
      ? summary.samples.map((s) => `  - ${s}`).join("\n")
      : "  None";

  const text = summary.newCount > 0
    ? [
        `:rotating_light: *Daily Bounce Extract Complete*`,
        `Run time: ${summary.duration}s`,
        ``,
        `*New bounces found: ${summary.newCount}*`,
        sampleLines,
        ``,
        `Total bounces in Instantly: ${summary.totalCount}`,
      ].join("\n")
    : [
        `:white_check_mark: *Daily Bounce Extract — No New Bounces*`,
        `Run time: ${summary.duration}s`,
        `Total bounces in Instantly: ${summary.totalCount}`,
      ].join("\n");

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`  Slack webhook returned ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error(`  Slack notification failed: ${err.message}`);
  }
}

main().catch(async (err) => {
  console.error("Bounce extraction failed:", err);

  if (!DRY_RUN && process.env.SLACK_WEBHOOK_URL) {
    try {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `:x: *Daily Bounce Extract FAILED*\n${err.message}`,
        }),
      });
    } catch (_) {}
  }

  process.exit(1);
});
