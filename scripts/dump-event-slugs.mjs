/**
 * Dumps all valid event slugs from Supabase to a JSON file.
 * The SEO agent reads this file to validate /events/[slug] links.
 *
 * Usage:
 *   node app/scripts/dump-event-slugs.mjs
 *
 * Output:
 *   seo-agent/src/config/valid-event-slugs.json
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
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
if (!SERVICE_ROLE_KEY) {
  console.error("Missing env: SUPABASE_SERVICE_ROLE_KEY (expected in app/.env.local)");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  // Fetch all event slugs with name and year
  const allSlugs = [];
  let start = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("events")
      .select("slug, name, year")
      .order("name")
      .order("year")
      .range(start, start + pageSize - 1);

    if (error) throw new Error(`Query failed: ${error.message}`);
    allSlugs.push(...(data || []));
    if (!data || data.length < pageSize) break;
    start += pageSize;
  }

  // Build byEventName mapping: { "CES": ["ces-2025", "ces-2026"], ... }
  const byEventName = {};
  for (const row of allSlugs) {
    const name = row.name;
    if (!byEventName[name]) byEventName[name] = [];
    byEventName[name].push(row.slug);
  }

  const slugSet = allSlugs.map((r) => r.slug).sort();

  const output = {
    generated: new Date().toISOString().slice(0, 10),
    count: slugSet.length,
    slugs: slugSet,
    byEventName,
  };

  const outputPath = join(
    __dirname,
    "../../seo-agent/src/config/valid-event-slugs.json"
  );
  writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`Dumped ${slugSet.length} event slugs to ${outputPath}`);
  console.log(`Event names: ${Object.keys(byEventName).length}`);

  // Print major events for quick reference
  const majorEvents = ["CES", "HIMSS", "NRF", "RSA Conference", "MWC Barcelona", "SXSW"];
  console.log("\nMajor event slugs:");
  for (const name of majorEvents) {
    const slugs = byEventName[name] || [];
    if (slugs.length > 0) {
      console.log(`  ${name}: ${slugs.join(", ")}`);
    } else {
      // Try partial match
      const matches = Object.entries(byEventName)
        .filter(([k]) => k.toLowerCase().includes(name.toLowerCase()))
        .map(([k, v]) => `${k}: ${v.join(", ")}`);
      if (matches.length > 0) {
        console.log(`  ${name} (partial match): ${matches.join("; ")}`);
      } else {
        console.log(`  ${name}: NOT FOUND`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
