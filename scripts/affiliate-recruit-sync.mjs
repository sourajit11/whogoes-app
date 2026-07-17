/**
 * Run the daily affiliate-recruit sync locally (same engine the
 * /api/affiliate-recruit/sync route runs in production).
 *
 * Usage:
 *   node app/scripts/affiliate-recruit-sync.mjs [--dry-run]
 *
 * --dry-run reports what would happen, writes nothing, calls no paid APIs.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syncAffiliateRecruits } from "../pipeline/lib/affiliate-recruit-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../.env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const supabase = createClient(
  "https://citrznhubxqvsfhjkssg.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const dryRun = process.argv.includes("--dry-run");
const summary = await syncAffiliateRecruits(supabase, { dryRun });
console.log(JSON.stringify(summary, null, 2));
