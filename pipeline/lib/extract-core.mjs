/**
 * Shared region-extraction core for the Plusvibe outreach pipeline.
 *
 * Reuses the same qualifying-event + contact-fetch logic the daily CLI uses,
 * but returns a plain JSON payload (leads + per-event watermarks) instead of
 * writing to a sheet. The HTTP route at /api/pipeline/extract calls this; a
 * separate /api/pipeline/commit advances the watermarks once Plusvibe accepts
 * the leads, so a failed push never silently skips contacts.
 */
import { getQualifyingEvents } from "./events.mjs";
import { fetchContactsForEvent } from "./contacts.mjs";
import { normalizeEventName } from "./utils.mjs";
import { getCampaignBucket } from "./constants.mjs";

const DEFAULT_LIMIT = 1000;

/**
 * Extract up to `limit` outreach leads for one region (US or EU), urgent first.
 *
 * @returns {Promise<{region, total, byBucket, leads, watermarks}>}
 *   leads:      ready for Plusvibe (email/first_name/last_name/company_name + custom vars)
 *   watermarks: [{ event_id, last_contact_created_at, count, previous_total }]
 *               — pass these to commit() only after the leads are safely added.
 */
export async function extractRegionLeads(supabase, { region, limit = DEFAULT_LIMIT } = {}) {
  const events = await getQualifyingEvents(supabase); // already sorted urgent-first
  const regionEvents = events.filter((e) => e.region === region);

  const leads = [];
  const watermarks = [];

  for (const event of regionEvents) {
    if (leads.length >= limit) break;

    const bucket = getCampaignBucket(event.event_start_date);
    if (!bucket) continue; // past, or further out than the outreach horizon

    let contacts = await fetchContactsForEvent(supabase, event);
    if (contacts.length === 0) continue;

    // Take oldest contacts first so a partial take leaves a clean watermark:
    // the max created_at of what we take is < every contact we skip.
    contacts.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));

    const remaining = limit - leads.length;
    const take = contacts.slice(0, remaining);

    const eventName = normalizeEventName(event.event_name);
    for (const c of take) {
      leads.push({
        email: c.email,
        first_name: c.firstName,
        last_name: c.lastName,
        company_name: c.companyName,
        event_name: eventName,
        event_date: event.event_start_date,
        contact_count: event.contacts_with_email,
        timing: bucket,
        campaign_bucket: bucket,
        event_id: event.event_id,
      });
    }

    const maxCreatedAt = take.reduce(
      (max, c) => (c.createdAt > max ? c.createdAt : max),
      take[0].createdAt
    );
    watermarks.push({
      event_id: event.event_id,
      last_contact_created_at: maxCreatedAt,
      count: take.length,
      previous_total: event.previousTotal,
    });
  }

  const byBucket = leads.reduce((acc, l) => {
    acc[l.campaign_bucket] = (acc[l.campaign_bucket] || 0) + 1;
    return acc;
  }, {});

  return { region, total: leads.length, byBucket, leads, watermarks };
}
