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
 * Accept rule: Reoon power `safe`/`valid`  OR  Dropleads email-finder `status = valid`.
 * See WHOGOES_COLD_OUTREACH_PIPELINE_PLAN.md.
 */

const MOLTSETS = "https://api.moltsets.com/api/v1/tools";
const DL_PRIME = "https://prime.dropleads.io/api/v1/prime-db";
const DL_FINDER = "https://api.dropleads.io/email-finder";
const REOON = "https://emailverifier.reoon.com/api/v1/verify";

const REOON_VALID = new Set(["safe", "valid", "deliverable"]);
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
    msLinkedinEmail: (linkedin_url) => postJson(`${MOLTSETS}/linkedin_to_best_email`, msH, { linkedin_url }),
    dlSearch: async (filters, limit = 10) => { await dlGate(); return postJson(`${DL_PRIME}/leads/search`, dlH, { filters, pagination: { page: 1, limit } }); },
    dlUnlock: async (leadId) => { await dlGate(); return postJson(`${DL_PRIME}/leads/unlock`, dlH, { leadId }); },
    dlFinder: async (first, last, domain) => { await dlGate(); return postJson(DL_FINDER, dlH, { first_name: first, last_name: last, company_domain: domain ? `https://${domain}` : "", company_name: "" }); },
    reoon: async (email) => {
      const url = `${REOON}?email=${encodeURIComponent(email)}&key=${encodeURIComponent(env.REOON_API_KEY)}&mode=power`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        const j = await res.json();
        return String(j?.status ?? j?.result ?? "unknown").trim().toLowerCase().replace(/\s+/g, "_");
      } catch { return "error"; }
    },
  };
}

// --- discovery for one company: founders + true sales, cap 5 ---
async function discoverPeople(V, company) {
  const domain = normDomain(company.website);
  if (!domain) return { domain, people: [] };
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

  // Moltsets A: sales department; B: founders/CEO
  const [a, b] = await Promise.all([
    V.msSearch(domain, { department: "Sales", limit: PER_COMPANY_CAP }),
    V.msSearch(domain, { query: "founder ceo owner", limit: PER_COMPANY_CAP }),
  ]);
  for (const src of [a, b]) {
    const ppl = src.json?.results?.results || [];
    for (const p of ppl) add({
      first_name: p.first_name, last_name: p.last_name, full_name: p.full_name,
      title: p.title, seniority: p.seniority, linkedin_url: p.linkedin_url,
      company_name: company.name, ms_inline_email: isEmail(p.business_email) ? p.business_email.trim() : null,
    }, "moltsets");
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
  return { domain, people };
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
    const st = await V.reoon(msEmail);
    if (REOON_VALID.has(st)) return { email: msEmail.toLowerCase(), provider: "moltsets", status: st, contactable: true };
    var best = { email: msEmail.toLowerCase(), provider: "moltsets", status: st, contactable: false };
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
      const st = await V.reoon(dbEmail);
      if (REOON_VALID.has(st)) return { email: dbEmail.toLowerCase(), provider: "dropleads", status: st, contactable: true };
      if (!best) best = { email: dbEmail.toLowerCase(), provider: "dropleads", status: st, contactable: false };
    }
  }

  // 3) Dropleads email-finder: accept its own `valid` status (no Reoon), else Reoon
  if (p.first_name && p.last_name) {
    const f = await V.dlFinder(p.first_name, p.last_name, p.company_domain);
    const gEmail = f.json?.email;
    const gStatus = String(f.json?.status || "").toLowerCase();
    if (isEmail(gEmail)) {
      if (gStatus === "valid") return { email: gEmail.toLowerCase(), provider: "dropleads_finder", status: "dl_valid", contactable: true };
      const st = await V.reoon(gEmail);
      if (REOON_VALID.has(st)) return { email: gEmail.toLowerCase(), provider: "dropleads_finder", status: st, contactable: true };
      if (!best) best = { email: gEmail.toLowerCase(), provider: "dropleads_finder", status: gStatus || st, contactable: false };
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
  if (!companies?.length) return { companies: 0, discovered: 0, contactable: 0, done: 0, detail: [] };

  const nowIso = new Date().toISOString();
  let discovered = 0, contactable = 0, done = 0;
  const detail = [];

  // Process several companies concurrently; the Dropleads start-gate keeps all of
  // them under 60/min while Reoon/Moltsets latency overlaps. Company concurrency of
  // 4 keeps the Dropleads pipe saturated without exhausting memory.
  await mapLimit(companies, 4, async (company) => {
    let peopleFound = 0, peopleContactable = 0;
    try {
      const { people } = await discoverPeople(V, company);
      // people within a company run concurrently too
      const outcomes = await mapLimit(people, people.length, async (p) => {
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
      for (const o of outcomes) { if (o) { peopleFound++; if (o === "contactable") peopleContactable++; } }
      discovered += peopleFound; contactable += peopleContactable;
    } catch (e) {
      detail.push({ company: company.name, error: String(e) });
    }
    await supabase.from("whogoes_cold_company_done").upsert(
      { company_id: company.id, people_found: peopleFound, people_sent: peopleContactable, processed_at: nowIso },
      { onConflict: "company_id" });
    done++;
    detail.push({ company: company.name, found: peopleFound, contactable: peopleContactable });
  });
  return { companies: companies.length, discovered, contactable, done, detail };
}
