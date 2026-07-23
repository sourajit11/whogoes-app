/**
 * Shared region-extraction core for the Plusvibe outreach pipeline.
 *
 * Reuses the same qualifying-event + contact-fetch logic the daily CLI uses,
 * but returns a plain JSON payload (leads + per-event watermarks) instead of
 * writing to a sheet. The HTTP route at /api/pipeline/extract calls this; a
 * separate /api/pipeline/commit advances the watermarks once Plusvibe accepts
 * the leads, so a failed push never silently skips contacts.
 *
 * Every lead is run through the Reoon + ESG gate (verify.mjs) before it is
 * returned, so catch-all / invalid / ESG-gated addresses never reach Plusvibe.
 */
import { getQualifyingEvents } from "./events.mjs";
import { fetchContactsForEvent } from "./contacts.mjs";
import { normalizeEventName } from "./utils.mjs";
import { getCampaignBucket } from "./constants.mjs";
import { createLeadGate } from "./verify.mjs";

const DEFAULT_LIMIT = 1000;
// Contacts are verified in fixed-size chunks; the chunk size is the Reoon
// concurrency. A chunk is atomic for the watermark: it either fully resolves
// (advancing the cursor past all of it) or is discarded (cursor stays put).
const CHUNK = 8;

function buildLead(event, eventName, bucket, contact) {
  return {
    email: contact.email,
    first_name: contact.firstName,
    last_name: contact.lastName,
    company_name: contact.companyName,
    event_name: eventName,
    event_date: event.event_start_date,
    // Total attendees shown on the public event page (social-proof number),
    // not just the emailable subset. Falls back to the emailable count.
    contact_count: event.total_contacts ?? event.contacts_with_email,
    timing: bucket,
    campaign_bucket: bucket,
    event_id: event.event_id,
  };
}

/**
 * Extract up to `limit` verified outreach leads for one region (US or EU),
 * urgent first.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ region: string, limit?: number, dryRun?: boolean }} options
 *   dryRun: verify against Reoon but never persist verdicts (local testing).
 * @returns {Promise<{region, total, byBucket, leads, watermarks, gate}>}
 *   leads:      Reoon-safe, ESG-clean, ready for Plusvibe
 *   watermarks: [{ event_id, last_contact_created_at, count, previous_total }]
 *               — pass to commit() only after the leads are safely added. The
 *               cursor never advances past a contact that was not verified.
 *   gate:       verification stats for this run
 */
export async function extractRegionLeads(supabase, { region, limit = DEFAULT_LIMIT, dryRun = false }) {
  const events = await getQualifyingEvents(supabase); // already sorted urgent-first
  const regionEvents = events.filter((e) => e.region === region);

  const gate = createLeadGate(supabase, { reoonKey: process.env.REOON_API_KEY, dryRun });

  const leads = [];
  const watermarks = [];

  for (const event of regionEvents) {
    if (leads.length >= limit) break;

    const bucket = getCampaignBucket(event.event_start_date);
    if (!bucket) continue; // past, or further out than the outreach horizon

    const contacts = await fetchContactsForEvent(supabase, event);
    if (contacts.length === 0) continue;

    // Oldest first so a partial take leaves a clean watermark: the cursor we
    // advance to is < every contact we have not yet processed.
    contacts.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

    // Prime stored verdicts for this event's candidates (one batched read).
    await gate.preload(contacts.map((c) => c.email));

    const eventName = normalizeEventName(event.event_name);
    let cursorMax = null;   // max created_at of contacts fully resolved this event
    let resolvedCount = 0;  // contacts processed (kept or dropped) — feeds total_extracted
    let stop = false;       // budget hit or Reoon unreachable -> end the run cleanly

    for (let i = 0; i < contacts.length && leads.length < limit; i += CHUNK) {
      if (gate.budgetExhausted()) { stop = true; break; }

      const chunk = contacts.slice(i, i + CHUNK);
      const verdicts = await Promise.all(chunk.map((c) => gate.resolve(c.email)));

      // Atomic chunk: if any address could not be verified (Reoon down) or the
      // budget ran out mid-chunk, discard the whole chunk. Its verdicts were
      // already persisted, so next run re-fetches it (cursor unchanged) and the
      // fast-path handles it instantly.
      if (verdicts.some((v) => !v.resolved) || gate.budgetExhausted()) { stop = true; break; }

      let hitLimit = false;
      for (let k = 0; k < chunk.length; k++) {
        // Stop before consuming a contact once the run is full: the cursor must
        // not advance past a lead we did not take, or it is skipped next run.
        if (leads.length >= limit) { hitLimit = true; break; }
        const c = chunk[k];
        if (!cursorMax || c.createdAt > cursorMax) cursorMax = c.createdAt;
        resolvedCount++;
        if (verdicts[k].keep) leads.push(buildLead(event, eventName, bucket, c));
      }
      if (hitLimit) { stop = true; break; }
    }

    if (cursorMax) {
      watermarks.push({
        event_id: event.event_id,
        last_contact_created_at: cursorMax,
        count: resolvedCount,
        previous_total: event.previousTotal,
      });
    }

    if (stop) break; // do not process further events once the budget is spent
  }

  const byBucket = leads.reduce((acc, l) => {
    acc[l.campaign_bucket] = (acc[l.campaign_bucket] || 0) + 1;
    return acc;
  }, {});

  return { region, total: leads.length, byBucket, leads, watermarks, gate: gate.stats };
}
