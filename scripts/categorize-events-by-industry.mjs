/**
 * Categorize every event in the `events` table into one of 20 industry buckets.
 *
 * Usage:
 *   # Dry run — writes app/scripts/industry-mapping.json, no DB writes:
 *   node app/scripts/categorize-events-by-industry.mjs
 *
 *   # Apply the mapping to Supabase (only rows currently NULL by default):
 *   node app/scripts/categorize-events-by-industry.mjs --apply
 *
 *   # Re-categorize every row, even ones that already have an industry:
 *   node app/scripts/categorize-events-by-industry.mjs --force
 *
 *   # Limit how many events get categorized this run (useful for testing):
 *   node app/scripts/categorize-events-by-industry.mjs --limit=20
 *
 * Requires in app/.env.local:
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - ANTHROPIC_API_KEY
 */

import { createClient } from "@supabase/supabase-js";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
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
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error("Missing env: SUPABASE_SERVICE_ROLE_KEY (expected in app/.env.local)");
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error("Missing env: ANTHROPIC_API_KEY (expected in app/.env.local)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 10;
// 30k input tokens/min rate limit + web_search adds ~20k of search context
// per call, so we pace ~1 call/min and on 429 wait for the retry-after window.
const BATCH_DELAY_MS = 25_000;
const MAX_RETRIES_429 = 4;
const OUTPUT_PATH = join(__dirname, "industry-mapping.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Fixed 21-bucket taxonomy. The prompt forbids any value outside this list.
const TAXONOMY = [
  "Healthcare & Medical",
  "Pharma & Life Sciences",
  "Technology & SaaS",
  "Cybersecurity",
  "AI & Data",
  "Manufacturing & Industrial",
  "Supply Chain & Logistics",
  "Retail & E-commerce",
  "Finance & FinTech",
  "Marketing, Sales & MarTech",
  "Legal & LegalTech",
  "Construction & Real Estate",
  "Energy, Sustainability & CleanTech",
  "Automotive & Mobility",
  "Aerospace & Defense",
  "Food, Beverage & Agriculture",
  "Hospitality, Travel & Events",
  "Media, Entertainment & Gaming",
  "Education & HR",
  "Beauty, Fashion & Consumer Goods",
  "Cannabis",
];
const TAXONOMY_SET = new Set(TAXONOMY);

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const LIMIT = (() => {
  const arg = args.find((a) => a.startsWith("--limit="));
  return arg ? Number(arg.split("=")[1]) : null;
})();

async function fetchEvents() {
  const all = [];
  let start = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("events")
      .select("id, slug, name, location, year, keywords, industry")
      .order("name")
      .range(start, start + pageSize - 1);
    if (error) throw new Error(`Fetch events failed: ${error.message}`);
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
    start += pageSize;
  }
  return all;
}

function buildPrompt(batch) {
  const eventsBlock = batch
    .map((e, i) => {
      const kw = Array.isArray(e.keywords) && e.keywords.length
        ? ` keywords: ${e.keywords.slice(0, 6).join(", ")}`
        : "";
      const loc = e.location ? ` location: ${e.location}` : "";
      return `${i + 1}. slug: ${e.slug}\n   name: ${e.name} (${e.year})${loc}${kw}`;
    })
    .join("\n");

  return `You are categorizing trade shows and conferences into ONE primary industry vertical each.

For every event below, research it with the web_search tool if the name and keywords are not enough on their own, then assign it to exactly ONE of these 20 industry buckets:

${TAXONOMY.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Hard rules:
- The output industry value MUST be one of the 20 strings above, copied exactly (same casing and punctuation).
- Never return "Multi-Industry", "Other", "General", or any value outside the list. If an event spans multiple verticals, pick the SINGLE most prominent one (e.g. HIMSS spans tech and healthcare; the dominant attendee profile is healthcare → "Healthcare & Medical").
- Use the event name first, keywords second, and web_search only when ambiguous.
- confidence is a number from 0 to 1 reflecting how sure you are.
- rationale is one short sentence, no more than 20 words.

Events to categorize:

${eventsBlock}

Return ONLY a JSON array, no prose before or after, in this exact shape:

[
  {"slug": "<slug>", "industry": "<one of the 20 buckets>", "confidence": 0.95, "rationale": "<short reason>"}
]

The array must contain exactly ${batch.length} objects, one per event, in the same order.`;
}

function extractJsonArray(text) {
  // The model may wrap output in markdown fences or prefix text despite the
  // prompt. Grab the first [...] block.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON array found in model output");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

async function callClaude(prompt) {
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES_429; attempt += 1) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 2,
          },
        ],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 30;
      const waitMs = Math.min(retryAfter, 90) * 1000 + 2000;
      console.log(`    429 rate limit, waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES_429 + 1})...`);
      await sleep(waitMs);
      lastErr = new Error("429 rate limit");
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${body}`);
    }
    const data = await res.json();

    // Concat all final text blocks (web_search tool_use blocks are interleaved
    // but server-side tools handle the loop — we just want the final text).
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return { text, usage: data.usage };
  }
  throw lastErr || new Error("Exhausted retries");
}

async function categorizeBatch(batch) {
  const prompt = buildPrompt(batch);
  const { text, usage } = await callClaude(prompt);
  const parsed = extractJsonArray(text);

  if (!Array.isArray(parsed)) {
    throw new Error("Model output is not a JSON array");
  }

  const bySlug = new Map(parsed.map((r) => [r.slug, r]));
  const results = [];
  for (const event of batch) {
    const row = bySlug.get(event.slug);
    if (!row) {
      console.warn(`  WARN: model skipped slug ${event.slug}`);
      results.push({
        slug: event.slug,
        name: event.name,
        industry: null,
        confidence: 0,
        rationale: "missing from model output",
        valid: false,
      });
      continue;
    }
    const valid = TAXONOMY_SET.has(row.industry);
    if (!valid) {
      console.warn(
        `  WARN: invalid industry "${row.industry}" for ${event.slug}`
      );
    }
    results.push({
      slug: event.slug,
      name: event.name,
      industry: valid ? row.industry : null,
      confidence: typeof row.confidence === "number" ? row.confidence : null,
      rationale: row.rationale || "",
      valid,
    });
  }
  return { results, usage };
}

async function applyMapping(mapping) {
  let updated = 0;
  let failed = 0;
  for (const row of mapping) {
    if (!row.valid || !row.industry) continue;
    const { error } = await supabase
      .from("events")
      .update({ industry: row.industry })
      .eq("slug", row.slug);
    if (error) {
      console.error(`  FAIL ${row.slug}: ${error.message}`);
      failed += 1;
    } else {
      updated += 1;
    }
  }
  return { updated, failed };
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (will write to Supabase)" : "DRY RUN"}`);
  console.log(`Force re-categorize: ${FORCE}`);
  if (LIMIT) console.log(`Limit: ${LIMIT}`);

  const allEvents = await fetchEvents();
  console.log(`Fetched ${allEvents.length} events from Supabase`);

  // Resume: if a prior mapping.json exists, keep its valid entries and skip
  // those slugs this run. Lets a rate-limited run pick up where it left off
  // without re-spending tokens. Skipped by --force.
  const validPriorBySlug = new Map();
  if (!FORCE && existsSync(OUTPUT_PATH)) {
    try {
      const prior = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
      for (const r of prior.results || []) {
        if (r.valid && r.industry) validPriorBySlug.set(r.slug, r);
      }
      if (validPriorBySlug.size > 0) {
        console.log(
          `Resuming from prior mapping: ${validPriorBySlug.size} slugs already valid`
        );
      }
    } catch (err) {
      console.warn(`Could not read prior mapping: ${err.message}`);
    }
  }

  let pending = FORCE
    ? allEvents
    : allEvents.filter(
        (e) => !e.industry && !validPriorBySlug.has(e.slug)
      );
  console.log(`Pending categorization: ${pending.length}`);

  if (LIMIT && pending.length > LIMIT) {
    pending = pending.slice(0, LIMIT);
    console.log(`Limited to first ${LIMIT}`);
  }

  if (pending.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const mapping = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(pending.length / BATCH_SIZE);
    console.log(
      `\nBatch ${batchNum}/${totalBatches} (${batch.length} events)...`
    );

    try {
      const { results, usage } = await categorizeBatch(batch);
      mapping.push(...results);
      if (usage) {
        totalInputTokens += usage.input_tokens || 0;
        totalOutputTokens += usage.output_tokens || 0;
      }
      const ok = results.filter((r) => r.valid).length;
      console.log(`  ok: ${ok}/${results.length}`);
    } catch (err) {
      console.error(`  BATCH FAILED: ${err.message}`);
      for (const e of batch) {
        mapping.push({
          slug: e.slug,
          name: e.name,
          industry: null,
          confidence: 0,
          rationale: `batch error: ${err.message}`,
          valid: false,
        });
      }
    }

    // Pace batches to stay under 30k input-tokens/min after web_search expands
    // the context. Skip on the final batch.
    if (i + BATCH_SIZE < pending.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  // Merge with prior valid entries so a resumed run produces a complete file.
  const mergedBySlug = new Map();
  for (const r of validPriorBySlug.values()) mergedBySlug.set(r.slug, r);
  for (const r of mapping) mergedBySlug.set(r.slug, r);
  const mergedResults = [...mergedBySlug.values()];

  // Persist the mapping JSON (always, even on --apply, as an audit trail).
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        model: MODEL,
        taxonomy: TAXONOMY,
        usage: {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
        },
        results: mergedResults,
      },
      null,
      2
    )
  );
  console.log(`\nWrote mapping to ${OUTPUT_PATH}`);

  const validCount = mergedResults.filter((r) => r.valid).length;
  console.log(`Valid: ${validCount}/${mergedResults.length}`);
  console.log(
    `Tokens this run: ${totalInputTokens} in / ${totalOutputTokens} out`
  );

  // Industry distribution
  const dist = {};
  for (const r of mergedResults) {
    if (r.valid) dist[r.industry] = (dist[r.industry] || 0) + 1;
  }
  console.log("\nDistribution:");
  for (const [industry, count] of Object.entries(dist).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${count.toString().padStart(4)}  ${industry}`);
  }

  if (APPLY) {
    console.log("\nApplying mapping to Supabase...");
    const { updated, failed } = await applyMapping(mergedResults);
    console.log(`Updated: ${updated}, Failed: ${failed}`);
  } else {
    console.log(
      "\nDry run complete. Re-run with --apply to write to Supabase."
    );
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
