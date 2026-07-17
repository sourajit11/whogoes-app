// One-off helper for large-post events whose --dump times out: given a file of
// comma/newline-separated candidate post ids (obtained via MCP, which has a longer
// statement timeout), fetch each post's content BY PRIMARY KEY (fast) and write the
// same role-cand-<slug>-NNN.jsonl chunk files extract-post-roles.mjs --ingest expects.
//
// Usage: node dump-candidates-byid.mjs --slug=<slug> --ids-file=<path> [--chunk=200]
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
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

const supabase = createClient("https://citrznhubxqvsfhjkssg.supabase.co", process.env.SUPABASE_SERVICE_ROLE_KEY);
const arg = (n) => process.argv.find((x) => x.startsWith(`--${n}=`))?.split("=")[1];
const SLUG = arg("slug");
const IDS_FILE = arg("ids-file");
const CHUNK = Number(arg("chunk") || 200);
const OUT = join(__dirname, "output");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const raw = readFileSync(IDS_FILE, "utf8").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
const ids = raw.filter((s) => UUID_RE.test(s));
const dropped = raw.length - ids.length;
console.log(`ids in file: ${raw.length} | valid: ${ids.length} | dropped (malformed): ${dropped}`);

const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const rows = [];
for (const batch of chunk(ids, 100)) {
  const { data, error } = await supabase.from("posts").select("id, author_type, content").in("id", batch);
  if (error) throw error;
  rows.push(...data);
}
rows.sort((a, b) => (a.id < b.id ? -1 : 1));
console.log(`fetched: ${rows.length}`);

const parts = chunk(rows, CHUNK);
for (let i = 0; i < parts.length; i++) {
  const file = join(OUT, `role-cand-${SLUG}-${String(i).padStart(3, "0")}.jsonl`);
  const body = parts[i].map((p) => JSON.stringify({
    id: p.id, author_type: p.author_type || "person",
    content: (p.content || "").replace(/\s+/g, " ").slice(0, 800),
  })).join("\n");
  writeFileSync(file, body);
}
console.log(`Wrote ${parts.length} chunk file(s) to ${OUT}/role-cand-${SLUG}-*.jsonl`);
