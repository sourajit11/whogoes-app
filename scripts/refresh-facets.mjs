import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
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

const eid = process.argv.find((x) => x.startsWith("--event-id="))?.split("=")[1];
if (!eid) { console.error("Usage: node refresh-facets.mjs --event-id=<uuid>"); process.exit(1); }

const { error } = await supabase.rpc("refresh_event_facets", { p_event_id: eid });
if (error) { console.error("refresh_event_facets failed:", error.message); process.exit(1); }
console.log("refresh_event_facets OK for", eid);
