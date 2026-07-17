// Splits an evidence JSON into N compact batch files for the sonnet subagents.
// Each batch file is a JSON array of trimmed packets (no huge fields) the subagent reasons over.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const h = process.argv.find(x => x.startsWith(`--${n}=`)); return h ? h.split("=").slice(1).join("=") : d; };

const evidence = JSON.parse(readFileSync(join(__dirname, "..", arg("evidence")), "utf8"));
const size = parseInt(arg("size", "20"), 10);
const outdir = arg("outdir", "scripts/output/batches");
mkdirSync(join(__dirname, "..", outdir), { recursive: true });

const trim = (p) => ({
  eventId: p.eventId, name: p.name, location: p.location, country: p.country, start_date: p.start_date,
  topCompanies: (p.topCompanies||[]).map(c => ({ companyId: c.companyId, name: c.name, domain: c.domain, contacts: c.contacts, sharePct: Math.round(c.share*100), companyPagePosts: c.companyPagePosts })),
  emailDomains: (p.emailDomains||[]).slice(0,8),
  deterministicGuess: p.deterministic ? { name: p.deterministic.name, companyId: p.deterministic.companyId, tier: p.deterministic.tier } : null,
});

let batchN = 0;
for (let i = 0; i < evidence.length; i += size) {
  batchN++;
  const batch = evidence.slice(i, i + size).map(trim);
  writeFileSync(join(__dirname, "..", outdir, `batch-${batchN}.json`), JSON.stringify(batch, null, 1));
}
console.log(`Wrote ${batchN} batches of up to ${size} events -> ${outdir}/batch-*.json`);
console.log(`Total events: ${evidence.length}`);
