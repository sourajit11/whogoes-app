/**
 * Reoon + ESG gate for the Plusvibe outreach pipeline.
 *
 * Every email that would be sent to a Plusvibe campaign is verified here before
 * it leaves the extract step. A lead is kept only when Reoon power mode says the
 * address is safe to send, it is NOT a catch-all, and its MX does not point at an
 * enterprise email gateway (Proofpoint, Mimecast, …) that blanket-rejects our
 * sending domains.
 *
 * The verdict is persisted back to contact_emails (status / esg / verified_at) so
 * the same address is never re-verified while the verdict is fresh, and so bad
 * addresses are excluded from future extracts. A fresh DB verdict is trusted
 * without an API call, which makes the gate self-draining: the 160k backlog of
 * unverified vendor-"valid" emails is checked once, as each is actually needed.
 *
 * Enforces the "only Reoon-safe emails go to Plusvibe" rule.
 */
import dns from "node:dns/promises";
import { fetchByIds } from "./supabase.mjs";

const REOON = "https://emailverifier.reoon.com/api/v1/verify";
const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_STATUS = new Set(["valid", "invalid", "bounced", "unverified", "catch_all"]);

// Enterprise gateways whose MX blanket-rejects our sending domains — same list the
// cold pipeline routes around (whogoes-cold-core.mjs).
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

// Returns the ESG provider gating this domain, or null for a plain provider we can
// send to. A DNS miss returns null (fail-open) so a transient lookup never drops a
// real lead — Reoon still has the final say on the address itself.
async function esgProvider(domain, cache) {
  if (!domain) return null;
  if (cache.has(domain)) return cache.get(domain);
  let hit = null;
  try {
    const mx = await dns.resolveMx(domain);
    outer: for (const r of mx) {
      const exchange = r.exchange || "";
      for (const [re, name] of ESG_PATTERNS) {
        if (re.test(exchange)) { hit = name; break outer; }
      }
    }
  } catch { hit = null; }
  cache.set(domain, hit);
  return hit;
}

// Reoon power-mode verify. Returns { status, safe, catchAll }. status "error" means
// Reoon was unreachable (network/timeout) — the caller must treat that as unresolved
// and retry later, never as a drop.
async function reoon(email, key) {
  const url = `${REOON}?email=${encodeURIComponent(email)}&key=${encodeURIComponent(key)}&mode=power`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const j = await res.json();
    const status = String(j?.status ?? "unknown").trim().toLowerCase().replace(/\s+/g, "_");
    return { status, safe: j?.is_safe_to_send === true, catchAll: j?.is_catch_all === true };
  } catch {
    return { status: "error", safe: false, catchAll: false };
  }
}

// Map a Reoon result to the status we persist (constrained vocabulary).
function persistedStatus({ status, safe, catchAll }) {
  if (safe) return "valid";
  if (catchAll || status === "catch_all" || status === "role_account") return "catch_all";
  if (["invalid", "disabled", "spamtrap", "disposable"].includes(status)) return "invalid";
  return "unverified"; // unknown / greylisted — revisit after the freshness window
}

/**
 * Create a lead gate bound to a Supabase admin client.
 *
 * @param {object} supabase       service-role client (reads contact_emails, writes verdicts)
 * @param {object} opts
 * @param {string} opts.reoonKey  Reoon API key (required)
 * @param {number} [opts.freshDays=7]  trust a stored verdict this many days before re-verifying
 * @param {number} [opts.budgetMs=190000]  wall-clock budget for live verification this run
 * @param {number} [opts.liveCap=1000]  max live Reoon calls this run
 * @param {boolean} [opts.dryRun=false]  when true, never write verdicts back (for local testing)
 */
export function createLeadGate(supabase, opts = {}) {
  const reoonKey = opts.reoonKey;
  if (!reoonKey) throw new Error("REOON_API_KEY missing — refusing to send unverified leads");
  const freshDays = opts.freshDays ?? 7;
  const budgetMs = opts.budgetMs ?? 190000;
  const liveCap = opts.liveCap ?? 1000;
  const dryRun = !!opts.dryRun;

  const startedAt = Date.now();
  const verdictCache = new Map(); // lower(email) -> { status, esg, verifiedAt }
  const mxCache = new Map();
  const stats = {
    fresh: 0, live: 0, kept: 0,
    dropped_catch_all: 0, dropped_esg: 0, dropped_invalid: 0, dropped_unknown: 0,
    reoon_errors: 0, persisted: 0,
  };

  // Store a verdict for every row that shares this address (same email -> same verdict).
  async function persist(email, status, esg) {
    if (dryRun) return;
    if (!ALLOWED_STATUS.has(status)) return;
    const { error } = await supabase
      .from("contact_emails")
      .update({ status, esg: esg || null, verified_at: new Date().toISOString() })
      .eq("email", email);
    if (error) { console.log(`    gate persist failed for ${email}: ${error.message}`); return; }
    stats.persisted++;
  }

  return {
    budgetExhausted() {
      return Date.now() - startedAt > budgetMs || stats.live >= liveCap;
    },
    stats,

    // Preload stored verdicts for a batch of candidate emails so the fresh-verdict
    // fast-path needs no per-email query.
    async preload(emails) {
      const uniq = [...new Set(emails.filter(Boolean))];
      const rows = await fetchByIds(supabase, "contact_emails", "email", uniq, "email, status, esg, verified_at");
      for (const r of rows) {
        const k = (r.email || "").toLowerCase();
        const prev = verdictCache.get(k);
        // Keep the most recently verified row when an address appears more than once.
        if (!prev || (r.verified_at && (!prev.verifiedAt || r.verified_at > prev.verifiedAt))) {
          verdictCache.set(k, { status: r.status, esg: r.esg, verifiedAt: r.verified_at });
        }
      }
    },

    // Resolve one address. Returns { keep, resolved, reason }.
    //   resolved=false  -> Reoon was unreachable; caller must not advance past it.
    async resolve(email) {
      const key = email.toLowerCase();
      const domain = key.split("@")[1] || "";
      const cached = verdictCache.get(key);
      const fresh = cached?.verifiedAt &&
        Date.now() - new Date(cached.verifiedAt).getTime() < freshDays * DAY_MS;

      if (fresh) {
        stats.fresh++;
        const keep = cached.status === "valid" && !cached.esg;
        if (keep) stats.kept++;
        return { keep, resolved: true, reason: keep ? "keep" : (cached.esg ? `esg:${cached.esg}` : cached.status) };
      }

      stats.live++;
      const [v, esg] = await Promise.all([reoon(email, reoonKey), esgProvider(domain, mxCache)]);
      if (v.status === "error") {
        stats.reoon_errors++;
        return { keep: false, resolved: false, reason: "reoon_error" };
      }

      const status = persistedStatus(v);
      await persist(email, status, esg);
      verdictCache.set(key, { status, esg: esg || null, verifiedAt: new Date().toISOString() });

      const keep = v.safe && !v.catchAll && !esg;
      let reason;
      if (keep) { stats.kept++; reason = "keep"; }
      else if (esg) { stats.dropped_esg++; reason = `esg:${esg}`; }
      else if (v.catchAll) { stats.dropped_catch_all++; reason = "catch_all"; }
      else if (status === "invalid") { stats.dropped_invalid++; reason = v.status; }
      else { stats.dropped_unknown++; reason = v.status; }
      return { keep, resolved: true, reason };
    },
  };
}
