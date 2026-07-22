/**
 * WhoGoes cold-outreach discovery + enrichment core.
 *
 * For a batch of unprocessed Apollo companies (get_whogoes_cold_companies), find
 * founders + true sales people via Moltsets (primary) + Dropleads (secondary),
 * resolve a deliverable email via a waterfall, verify with Reoon, and upsert into
 * whogoes_prospects. Every company in the batch is recorded in
 * whogoes_cold_company_done so it is never re-selected.
 *
 * Vendors: Moltsets + Dropleads only (GetLeads dropped — 0 incremental coverage).
 * ESG gate (FIRST): a company whose MX points at an enterprise security gateway
 * (Proofpoint/Mimecast/Sophos/IronPort/Barracuda/...) is skipped before any discovery
 * or verification — those gateways 5.7.1-block our sending domains so mail never lands.
 * Accept rule (HARD): every candidate email is Reoon power-mode verified, and only
 * `is_safe_to_send === true AND is_catch_all !== true` is marked contactable / eligible
 * for Plusvibe. Reoon can flag a catch-all mailbox "safe" and it still bounces, so
 * catch-all is excluded explicitly. No vendor's own "valid" is ever trusted (Dropleads
 * calls catch-alls valid → they bounce).
 * See WHOGOES_COLD_OUTREACH_PIPELINE_PLAN.md.
 */

import dns from "node:dns/promises";

const MOLTSETS = "https://api.moltsets.com/api/v1/tools";
const DL_PRIME = "https://prime.dropleads.io/api/v1/prime-db";
const DL_FINDER = "https://api.dropleads.io/email-finder";
const REOON = "https://emailverifier.reoon.com/api/v1/verify";

const PER_COMPANY_CAP = 5;
const DL_MIN_INTERVAL_MS = 1100; // stay under Dropleads' 60 req/min

// Titles to drop (Apollo's "Sales" function sweeps in Customer Success / AM).
const EXCLUDE_TITLE =
  /(customer|client)\s+success|account manager|customer experience|customer support|technical support|onboarding|implementation|solutions? engineer/i;

// --- small utils ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normDomain(w) {
  if (!w) return "";
  return String(w).trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "")
    .split("/")[0].split("?")[0].trim().toLowerCase();
}
function normLinkedin(u) {
  if (!u) return "";
  let s = decodeURIComponent(String(u)).trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").split("?")[0].replace(/\/+$/, "");
  return s;
}
const isEmail = (e) => typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());

function deepEmail(obj) {
  if (isEmail(obj)) return obj.trim();
  if (Array.isArray(obj)) { for (const it of obj) { const e = deepEmail(it); if (e) return e; } return null; }
  if (obj && typeof obj === "object") {
    for (const k of ["email", "business_email", "email_address", "best_email"]) {
      if (isEmail(obj[k])) return obj[k].trim();
    }
    for (const v of Object.values(obj)) { const e = deepEmail(v); if (e) return e; }
  }
  return null;
}

// Seniority ranking (lower = keep first). Founders/CEO win, ICs last.
function rankTitle(t) {
  const s = (t || "").toLowerCase();
  if (/founder|co-?founder|chief exec|\bceo\b|owner|president|managing partner|\bpartner\b/.test(s)) return 1;
  if (/\bcro\b|chief revenue|vp|vice president|head of|chief/.test(s)) return 2;
  if (/director/.test(s)) return 3;
  if (/manager|lead\b/.test(s)) return 4;
  if (/account executive|\bae\b|business development|\bbdr\b|\bsdr\b|sales/.test(s)) return 5;
  return 6;
}

async function postJson(url, headers, body, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: { _err: String(e) } };
  } finally { clearTimeout(t); }
}

// Start-gate limiter: serializes only the *start* of calls to >= minInterval apart,
// so many concurrent Dropleads calls respect 60/min while their network latency overlaps.
function makeStartGate(minIntervalMs) {
  let last = 0;
  let queue = Promise.resolve();
  return () => {
    queue = queue.then(async () => {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
    });
    return queue;
  };
}

// Run async tasks with bounded concurrency.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return results;
}

// --- MX / ESG gateway detection ---
// Our sending domains are blocklisted at third-party enterprise email gateways, which
// blanket-reject them with 5.7.1. You cannot get past those gateways, so route AROUND
// them: skip any company whose MX points at one, BEFORE spending discovery/verify credits.
// Plain Google / Microsoft recipients are the target and are intentionally not gated.
const ESG_PATTERNS = [
  [/mimecast/i, "mimecast"],
  [/pphosted\.com|ppe-hosted\.com|proofpoint/i, "proofpoint"],
  [/barracuda|cudasvc/i, "barracuda"],
  [/iphmx\.com|ironport/i, "cisco-ironport"],
  [/messagelabs\.com|symanteccloud/i, "symantec-messagelabs"],
  [/mailcontrol\.com|forcepoint|websense/i, "forcepoint"],
  [/fortimail|fortinet/i, "fortinet"],
  [/tmes\.trendmicro|trendmicro/i, "trendmicro"],
  [/sophos|reflexion/i, "sophos"],
  [/spamtitan|mailchannels|mxthunder/i, "other-esg"],
];
const mxCache = new Map();
// Returns the ESG provider name gating this domain (e.g. "proofpoint"), or null if the MX
// is a plain provider we can send to. A DNS miss returns null (fail-open — let the verifier
// decide) so a transient lookup error never skips a real company.
async function esgProvider(domain) {
  if (!domain) return null;
  if (mxCache.has(domain)) return mxCache.get(domain);
  let hit = null;
  try {
    const mx = await dns.resolveMx(domain);
    outer: for (const r of mx) {
      const exchange = r.exchange || "";
      for (const [re, name] of ESG_PATTERNS) { if (re.test(exchange)) { hit = name; break outer; } }
    }
  } catch { hit = null; }
  mxCache.set(domain, hit);
  return hit;
}

// --- vendor clients ---
function makeVendors(env) {
  const msH = { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${env.MOLTSETS_API_KEY}` };
  const dlH = { accept: "application/json", "content-type": "application/json", "X-API-Key": env.DROPLEADS_API_KEY };

  // Dropleads global start-gate across the whole batch (60/min → >=1.1s between starts).
  const dlGate = makeStartGate(DL_MIN_INTERVAL_MS);

  return {
    msSearch: (companyDomain, { department, query, limit = 5 }) =>
      postJson(`${MOLTSETS}/search_people`, msH,
        { company_domain: companyDomain, ...(department ? { department } : {}), ...(query ? { query } : {}), limit }),
    // Same endpoint, filtered by company NAME instead of company_domain. Used as a fallback
    // when the company_domain filter returns not_found (Moltsets domain-index regression,
    // 2026-07); callers must re-verify the returned people's domain against the target.
    msSearchByName: (companyName, { department, query, limit = 5 }) =>
      postJson(`${MOLTSETS}/search_people`, msH,
        { company: companyName, ...(department ? { department } : {}), ...(query ? { query } : {}), limit }),
    msLinkedinEmail: (linkedin_url) => postJson(`${MOLTSETS}/linkedin_to_best_email`, msH, { linkedin_url }),
    dlSearch: async (filters, limit = 10) => { await dlGate(); return postJson(`${DL_PRIME}/leads/search`, dlH, { filters, pagination: { page: 1, limit } }); },
    dlUnlock: async (leadId) => { await dlGate(); return postJson(`${DL_PRIME}/leads/unlock`, dlH, { leadId }); },
    dlFinder: async (first, last, domain) => { await dlGate(); return postJson(DL_FINDER, dlH, { first_name: first, last_name: last, company_domain: domain ? `https://${domain}` : "", company_name: "" }); },
    // Power-mode verify. Returns { status, safe, catchAll }. `safe` is Reoon's own
    // is_safe_to_send boolean; `catchAll` is is_catch_all. RULE: only emails that are
    // safe AND not catch-all may be marked contactable — Reoon sometimes flags a
    // catch-all mailbox "safe" (score ~88) and it still hard-bounces, so we exclude
    // catch-all explicitly rather than trusting is_safe_to_send alone.
    reoon: async (email) => {
      const url = `${REOON}?email=${encodeURIComponent(email)}&key=${encodeURIComponent(env.REOON_API_KEY)}&mode=power`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        const j = await res.json();
        const status = String(j?.status ?? j?.result ?? "unknown").trim().toLowerCase().replace(/\s+/g, "_");
        return { status, safe: j?.is_safe_to_send === true, catchAll: j?.is_catch_all === true };
      } catch { return { status: "error", safe: false, catchAll: false }; }
    },
  };
}

// --- discovery for one company: founders + true sales, cap 5 ---
async function discoverPeople(V, company) {
  const domain = normDomain(company.website);
  if (!domain) return { domain, people: [], vendorError: false };
  // ESG/MX gate FIRST — skip enterprise-gateway domains before any discovery or Reoon
  // spend; those gateways 5.7.1-block our sending domains so mail can never land.
  const esg = await esgProvider(domain);
  if (esg) return { domain, people: [], esg };
  const byKey = new Map();
  const add = (p, foundBy, dlLeadId) => {
    const li = normLinkedin(p.linkedin_url);
    const key = li || `name::${(p.first_name || "").toLowerCase()}|${(p.last_name || "").toLowerCase()}|${domain}`;
    const ex = byKey.get(key);
    if (ex) {
      if (!ex.found_by.includes(foundBy)) ex.found_by.push(foundBy);
      if (!ex.dl_lead_id && dlLeadId) ex.dl_lead_id = dlLeadId;
      if (!ex.ms_inline_email && p.ms_inline_email) ex.ms_inline_email = p.ms_inline_email;
      return;
    }
    byKey.set(key, { ...p, company_domain: domain, found_by: [foundBy], dl_lead_id: dlLeadId || null });
  };

  // Distinguish a genuine transport/server failure (retry-worthy) from Moltsets' NORMAL
  // "no results" answer — which it returns as HTTP 404 with { status:"not_found" }. A 404
  // is a valid empty result, NOT an error, so it must not gate marking the company done
  // (otherwise every legitimately-empty company would be re-processed forever). Only a
  // network failure (status 0), rate limit (429), or 5xx counts as a hard error here; a
  // whole batch coming back empty is caught separately in runColdDiscovery.
  const hardFail = (r) => r.status === 0 || r.status === 429 || r.status >= 500;
  let moltsetsHardError = false;

  // Ingest Moltsets people from one search response. When verifyDomain is set (the name
  // fallback), keep only people whose company website resolves to our target domain — so a
  // same-named but different company can never leak in. Returns how many were kept.
  const ingestMs = (res, { verifyDomain = false } = {}) => {
    if (hardFail(res)) moltsetsHardError = true;
    let kept = 0;
    for (const p of (res.json?.results?.results || [])) {
      if (verifyDomain && normDomain(p.company?.website_url) !== domain) continue;
      add({
        first_name: p.first_name, last_name: p.last_name, full_name: p.full_name,
        title: p.title, seniority: p.seniority, linkedin_url: p.linkedin_url,
        company_name: company.name, ms_inline_email: isEmail(p.business_email) ? p.business_email.trim() : null,
      }, "moltsets");
      kept++;
    }
    return kept;
  };

  // PRIMARY: Moltsets by company NAME, keeping only people whose company website resolves to
  // our target domain. Name search has proven broader coverage than company_domain and is not
  // affected by the company_domain index outage (2026-07), so it is the primary source.
  // IMPORTANT: do NOT add department/query to a NAME search — unlike company_domain (a hard
  // exact filter), the company name filter LOOSENS when combined with department/query and
  // returns people from other companies (domain-verify then drops them all -> 0 found). A
  // plain name search returns the right company's people; rankTitle below picks founders/sales.
  if (company.name) {
    const r = await V.msSearchByName(company.name, { limit: 10 });
    ingestMs(r, { verifyDomain: true });
  }

  // TOP-UP: if the name search did not fill the per-company cap, add Moltsets' exact
  // company_domain search to recover anyone the name index truncated or missed. While
  // company_domain is degraded it returns nothing and costs no extra results; once Moltsets
  // fixes it this contributes automatically. Also the sole source when a company has no name.
  if (byKey.size < PER_COMPANY_CAP && !moltsetsHardError) {
    const [d1, d2] = await Promise.all([
      V.msSearch(domain, { department: "Sales", limit: PER_COMPANY_CAP }),
      V.msSearch(domain, { query: "founder ceo owner", limit: PER_COMPANY_CAP }),
    ]);
    ingestMs(d1);
    ingestMs(d2);
  }

  // Dropleads secondary (also captures Moltsets-missed people; keep lead id for free unlock)
  const dl = await V.dlSearch({ companyDomains: [domain], departments: ["Sales"] }, 10);
  for (const ld of (dl.json?.data?.leads || [])) add({
    first_name: ld.firstName, last_name: ld.lastName, full_name: ld.fullName,
    title: ld.title, seniority: null, linkedin_url: ld.linkedinUrl, company_name: company.name,
  }, "dropleads", ld.id);

  const people = [...byKey.values()]
    .filter((p) => !EXCLUDE_TITLE.test(p.title || ""))
    .sort((x, y) => rankTitle(x.title) - rankTitle(y.title))
    .slice(0, PER_COMPANY_CAP);
  return { domain, people, moltsetsHardError };
}

// --- email waterfall + verify for one person ---
async function resolveEmail(V, p) {
  // 1) Moltsets: inline business_email, else linkedin_to_best_email -> Reoon
  let msEmail = p.ms_inline_email;
  if (!msEmail && p.linkedin_url) {
    const r = await V.msLinkedinEmail(p.linkedin_url);
    msEmail = deepEmail(r.json?.results) || deepEmail(r.json);
  }
  if (isEmail(msEmail)) {
    const v = await V.reoon(msEmail);
    if (v.safe && !v.catchAll) return { email: msEmail.toLowerCase(), provider: "moltsets", status: v.status, contactable: true };
    var best = { email: msEmail.toLowerCase(), provider: "moltsets", status: v.status, contactable: false };
  }

  // 2) Dropleads prime-DB: use lead id if we have one, else find by linkedin -> unlock -> Reoon
  let leadId = p.dl_lead_id;
  if (!leadId && p.linkedin_url) {
    const s = await V.dlSearch({ linkedinUrls: [p.linkedin_url] }, 1);
    leadId = s.json?.data?.leads?.[0]?.id || null;
  }
  if (leadId) {
    const u = await V.dlUnlock(leadId);
    const dbEmail = deepEmail(u.json?.data?.lead) || deepEmail(u.json);
    if (isEmail(dbEmail)) {
      const v = await V.reoon(dbEmail);
      if (v.safe && !v.catchAll) return { email: dbEmail.toLowerCase(), provider: "dropleads", status: v.status, contactable: true };
      if (!best) best = { email: dbEmail.toLowerCase(), provider: "dropleads", status: v.status, contactable: false };
    }
  }

  // 3) Dropleads email-finder: ALWAYS Reoon power-verify. Never trust Dropleads'
  //    own `valid` status — it labels catch-all domains valid, and those bounce.
  if (p.first_name && p.last_name) {
    const f = await V.dlFinder(p.first_name, p.last_name, p.company_domain);
    const gEmail = f.json?.email;
    if (isEmail(gEmail)) {
      const v = await V.reoon(gEmail);
      if (v.safe && !v.catchAll) return { email: gEmail.toLowerCase(), provider: "dropleads_finder", status: v.status, contactable: true };
      if (!best) best = { email: gEmail.toLowerCase(), provider: "dropleads_finder", status: v.status, contactable: false };
    }
  }

  return best || { email: null, provider: null, status: null, contactable: false };
}

/**
 * Process up to `limit` unprocessed companies end-to-end.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{limit?: number, env?: object}} opts
 */
export async function runColdDiscovery(supabase, { limit = 25, env = process.env } = {}) {
  const V = makeVendors(env);
  const { data: companies, error } = await supabase.rpc("get_whogoes_cold_companies", { p_limit: limit });
  if (error) throw new Error(`get_whogoes_cold_companies: ${error.message}`);
  if (!companies?.length) return { companies: 0, discovered: 0, contactable: 0, done: 0, skippedVendorError: 0, esgSkipped: 0, vendorLikelyDown: false, detail: [] };

  const nowIso = new Date().toISOString();
  const detail = [];
  const outcomes = []; // { company, peopleFound, peopleContactable, hardError, esg }
  let discovered = 0, contactable = 0;

  // Process several companies concurrently; the Dropleads start-gate keeps all of
  // them under 60/min while Reoon/Moltsets latency overlaps. Company concurrency of
  // 4 keeps the Dropleads pipe saturated without exhausting memory. We collect outcomes
  // first and decide which companies to mark "done" afterward, so a batch-wide vendor
  // outage can be detected before anything is burned.
  await mapLimit(companies, 4, async (company) => {
    let peopleFound = 0, peopleContactable = 0, hardError = false, esg = null;
    try {
      const { people, moltsetsHardError, esg: esgHit } = await discoverPeople(V, company);
      hardError = moltsetsHardError;
      esg = esgHit || null;
      // people within a company run concurrently too
      const found = await mapLimit(people, people.length, async (p) => {
        const li = p.linkedin_url;
        if (li) {
          const { data: existing } = await supabase.from("whogoes_prospects")
            .select("id").eq("linkedin_url", li).maybeSingle();
          if (existing) return null; // already in the store — skip
        }
        const res = await resolveEmail(V, p);
        await supabase.from("whogoes_prospects").upsert({
          linkedin_url: li,
          full_name: p.full_name, first_name: p.first_name, last_name: p.last_name, title: p.title,
          company_id: company.id, company_name: company.name, company_domain: p.company_domain,
          industry: company.industry,
          discovered_by: p.found_by,
          email: res.email, email_provider: res.provider, email_status: res.status,
          is_contactable: res.contactable,
          verified_at: res.contactable ? nowIso : null,
          campaign_status: "new", source: "apollo+moltsets+dropleads",
        }, { onConflict: "linkedin_url", ignoreDuplicates: true });
        return res.contactable ? "contactable" : "found";
      });
      for (const o of found) { if (o) { peopleFound++; if (o === "contactable") peopleContactable++; } }
      discovered += peopleFound; contactable += peopleContactable;
    } catch (e) {
      hardError = true; // an unexpected throw is also an unreliable result — don't burn the company
      detail.push({ company: company.name, error: String(e) });
    }
    outcomes.push({ company, peopleFound, peopleContactable, hardError, esg });
  });

  // Batch-level outage guard. Moltsets signals "no results" with an HTTP 404, which per
  // request is indistinguishable from a genuinely empty company. But a whole batch coming
  // back empty is not credible (some companies always have discoverable people), so treat a
  // near-total zero-yield batch as a vendor outage and hold every affected company back for
  // the next run. Normal zero-yield runs ~20-45% of a batch, so 85% cleanly flags an outage.
  // Two independent degradation signals, because Moltsets' 404-for-empty means a partial
  // outage looks like a batch of mostly-empty companies, not a hard error:
  //   (a) zero-yield ratio >= 60% (normal runs sit at 20-45%), and
  //   (b) average people/company < 1.2 (healthy days run 1.8-3.7; a degraded day like
  //       2026-07-14 ran 0.14). The avg floor catches "bad but not total" days where
  //       per-batch zero-ratios hover just under the ratio threshold and would otherwise burn.
  // Tightened from 70%/0.8 after 2026-07-16: a PARTIAL Moltsets outage kept batches at
  // ~60-69% zero AND avg ~0.8-0.9 (just inside both old thresholds), so 395 companies were
  // burned. Healthy per-batch avg is 2-4, so 1.2 stays clear of false positives.
  // ESG-gated companies count as a legitimate zero-yield (they are correctly skipped), so
  // they must NOT inflate the outage signal — exclude them from both ratio and average.
  const scored = outcomes.filter((o) => !o.esg);
  const zeroYield = scored.filter((o) => o.peopleFound === 0).length;
  const avgYield = scored.length
    ? scored.reduce((sum, o) => sum + o.peopleFound, 0) / scored.length
    : 0;
  const vendorLikelyDown =
    scored.length >= 8 && (zeroYield >= 0.6 * scored.length || avgYield < 1.2);

  let done = 0, skippedVendorError = 0;
  const doneRows = [];
  for (const o of outcomes) {
    // Skip marking done (leave in pool) only when we found nobody AND the miss is
    // attributable to a vendor problem — a hard transport error or a batch-wide outage.
    // An isolated empty result in an otherwise-healthy batch is a real "no people" company
    // and IS marked done, so it is never re-processed forever. ESG-gated companies are
    // always marked done (the skip is deliberate, not a vendor miss).
    if (!o.esg && o.peopleFound === 0 && (o.hardError || vendorLikelyDown)) {
      skippedVendorError++;
      detail.push({ company: o.company.name, skipped: vendorLikelyDown ? "vendor_outage" : "vendor_error" });
      continue;
    }
    doneRows.push({
      company_id: o.company.id, people_found: o.peopleFound,
      people_sent: o.peopleContactable, processed_at: nowIso,
    });
    done++;
    detail.push({ company: o.company.name, found: o.peopleFound, contactable: o.peopleContactable, ...(o.esg ? { esg: o.esg } : {}) });
  }
  if (doneRows.length) {
    await supabase.from("whogoes_cold_company_done").upsert(doneRows, { onConflict: "company_id" });
  }
  const esgSkipped = outcomes.filter((o) => o.esg).length;
  return { companies: companies.length, discovered, contactable, done, skippedVendorError, esgSkipped, vendorLikelyDown, avgYield: Number(avgYield.toFixed(2)), detail };
}
