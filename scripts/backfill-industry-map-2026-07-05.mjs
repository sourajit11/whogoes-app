// One-off backfill: categorize companies stuck at 'Other / Unknown' whose raw
// `industry` string is a known Apollo/Moltsets-style value not previously mapped
// (or mapped in JSON but never backfilled into existing rows).
//
// - Extends company-industry-mapping.json with any missing strings (lasting fix).
// - Backfills companies.industry_bucket + propagates to event_contact_facts via
//   the set_company_industry_bucket RPC (keeps the per-event view in sync).
//
// Usage: node backfill-industry-map-2026-07-05.mjs           (dry run: counts only)
//        node backfill-industry-map-2026-07-05.mjs --apply    (writes to DB + JSON)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes("--apply");

// Raw industry string (exactly as stored) -> approved WhoGoes bucket.
const NEW_MAPPINGS = {
  "Information Technology": "Software & IT Services",
  "IT System Operations and Maintenance": "Software & IT Services",
  "Professional and Business Services": "Management Consulting & Business Services",
  "Corporate Services": "Management Consulting & Business Services",
  "Equipment Rental Services": "Management Consulting & Business Services",
  "Repair and Maintenance": "Management Consulting & Business Services",
  "Creative Arts and Entertainment": "Media & Entertainment",
  "Media and Publishing": "Media & Entertainment",
  "Non-Profit and Social Services": "Nonprofit, NGO & Associations",
  "nonprofit organization management": "Nonprofit, NGO & Associations",
  "fund-raising": "Nonprofit, NGO & Associations",
  "medical devices": "Medical Devices",
  "Finance and Banking": "Financial Services & Banking",
  "Health and Pharmaceuticals": "Healthcare & Hospitals",
  "Pharmaceuticals and Biotechnology": "Pharmaceuticals",
  "Tourism and Hospitality": "Hospitality, Travel & Leisure",
  "Hotels and Motels": "Hospitality, Travel & Leisure",
  "electrical/electronic manufacturing": "Electrical & Electronics Manufacturing",
  "Government and Public Administration": "Government & Public Sector",
  "Government": "Government & Public Sector",
  "Transportation and Logistics": "Transportation & Logistics",
  "Food and Beverage": "Food & Beverage",
  "Wholesale Food and Beverage": "Food & Beverage",
  "Energy": "Oil, Gas & Utilities",
  "Chemical Raw Materials Manufacturing": "Chemicals & Plastics",
  "Plastics and Rubber Product Manufacturing": "Chemicals & Plastics",
  "Paint, Coating, and Adhesive Manufacturing": "Chemicals & Plastics",
  "Metalworking Machinery Manufacturing": "Industrial Machinery & Automation",
  "Glass Product Manufacturing": "Manufacturing - Other",
  "Transportation Equipment Manufacturing": "Manufacturing - Other",
  "Wholesale Metals and Minerals": "Mining & Metals",
  "Retail Recyclable Materials & Used Merchandise": "Retail & Wholesale",
  "Soap and Cleaning Product Manufacturing": "Consumer Goods",
  "Wholesale Apparel and Sewing Supplies": "Apparel, Fashion & Luxury",
  "Wholesale Luxury Goods and Jewelry": "Apparel, Fashion & Luxury",
  "Cosmetology and Barber Schools": "Education",
  "Housing and Community Development": "Real Estate",
  "Agriculture": "Agriculture, Farming & Fishing",
  "Specialty Trade Contractors": "Construction & Building Materials",
};

function loadEnv() {
  const envPath = path.resolve(__dirname, "../../.env");
  const env = fs.readFileSync(envPath, "utf8");
  const get = (k) => {
    const m = env.match(new RegExp("^" + k + "=(.*)$", "m"));
    return m ? m[1].trim() : null;
  };
  return { SUPA: get("SUPABASE_URL"), KEY: get("SUPABASE_SERVICE_KEY") };
}

const { SUPA, KEY } = loadEnv();
const H = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

async function getCompanies(rawIndustry) {
  // Companies stuck at Other/Unknown with this exact raw industry.
  const q =
    `companies?select=id&industry_bucket=eq.Other %2F Unknown&industry=eq.` +
    encodeURIComponent(rawIndustry);
  let out = [], from = 0;
  while (true) {
    const r = await fetch(SUPA + "/rest/v1/" + q, { headers: { ...H, Range: `${from}-${from + 999}` } });
    const j = await r.json();
    if (!Array.isArray(j) || j.length === 0) break;
    out = out.concat(j.map((x) => x.id));
    if (j.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function setBucket(companyId, bucket) {
  const r = await fetch(SUPA + "/rest/v1/rpc/set_company_industry_bucket", {
    method: "POST",
    headers: H,
    body: JSON.stringify({ p_company_id: companyId, p_bucket: bucket }),
  });
  if (!r.ok) throw new Error(`RPC failed ${r.status}: ${await r.text()}`);
}

function updateMappingFile() {
  const p = path.resolve(__dirname, "company-industry-mapping.json");
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const existing = new Set(Object.keys(j.map).map((k) => k.trim().toLowerCase()));
  let added = 0;
  for (const [raw, bucket] of Object.entries(NEW_MAPPINGS)) {
    if (!existing.has(raw.trim().toLowerCase())) {
      j.map[raw] = bucket;
      added++;
    }
  }
  if (APPLY) fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  return added;
}

(async () => {
  console.log(APPLY ? "=== APPLY MODE (writing) ===" : "=== DRY RUN (counts only) ===\n");

  let totalCompanies = 0;
  const perString = [];
  for (const [raw, bucket] of Object.entries(NEW_MAPPINGS)) {
    const ids = await getCompanies(raw);
    perString.push([raw, bucket, ids]);
    totalCompanies += ids.length;
  }

  perString
    .sort((a, b) => b[2].length - a[2].length)
    .forEach(([raw, bucket, ids]) =>
      console.log(String(ids.length).padStart(5), `${raw}  ->  ${bucket}`)
    );
  console.log(`\nTotal companies to reclassify: ${totalCompanies}`);

  const mapAdds = updateMappingFile();
  console.log(`Mapping file: ${mapAdds} new string(s) ${APPLY ? "added" : "would be added"}.`);

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to write.");
    return;
  }

  let done = 0, failed = 0;
  for (const [raw, bucket, ids] of perString) {
    for (const id of ids) {
      try {
        await setBucket(id, bucket);
        done++;
      } catch (e) {
        failed++;
        console.error("FAIL", id, e.message);
      }
    }
    console.log(`  [${raw}] ${ids.length} done`);
  }
  console.log(`\nDONE. Reclassified ${done} companies (${failed} failed).`);
})();
