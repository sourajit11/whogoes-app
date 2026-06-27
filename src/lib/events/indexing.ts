import noindexedConfig from "@/config/noindexed-event-slugs.json";

/**
 * Single source of truth for "should this /events/[slug] page be indexable?"
 * Used by BOTH the page's robots meta (src/app/events/[slug]/page.tsx) and the
 * event sitemap (src/app/sitemap.ts) so the two can never disagree.
 *
 * Two modes:
 *
 *   "denylist" (current default) - legacy behavior: an event is indexable
 *      UNLESS its slug is in the manual prune list. This is what shipped with
 *      the 327-page prune. Keeping it as the default means flipping this file
 *      on does NOT change live indexing until we deliberately switch to "gate".
 *
 *   "gate" - data-driven quality gate: NOINDEX by default; an event becomes
 *      indexable only when it is substantive and timely (see EVENT_GATE).
 *      Self-maintaining: new events start noindex and graduate the day they
 *      cross the gate; stale post-event pages drop out automatically.
 *
 * WHEN TO FLIP TO "gate": only AFTER the apex blog + compare pages are indexing
 * well on whogoes.co (crawl-budget reality - mass-exposing thin event pages
 * before then wastes crawl on pages we don't want ranked). This decision is
 * owned by the weekly SEO/AEO check. See SEO_AEO_PROGRESS_TRACKER.md
 * (Workstream 1) and seo-agent/SEO_EXECUTION_CALENDAR.md (Workstream E).
 */
export const EVENT_INDEX_MODE: "denylist" | "gate" = "gate";

/** Quality-gate thresholds (used only in "gate" mode). Tune deliberately. */
export const EVENT_GATE = {
  /** Minimum tracked contacts for the page to carry real substance. */
  minContacts: 40,
  /** Concentrate crawl budget on live, rising pre-event intent. Index only
   *  upcoming or still-running events (started within this many days), so
   *  recently-ended pages whose "[event] attendee list" intent has collapsed
   *  stay noindex. Set to 3 (2026-06-28) to shrink the indexable set from ~347
   *  to ~53 during the low-authority test phase; widen once authority grows. */
  postEventGraceDays: 3,
} as const;

const NOINDEXED_SLUGS = new Set<string>(noindexedConfig.slugs);

/** The subset of event fields the gate reads. Matches BrowsableEvent names. */
export interface EventIndexInput {
  event_slug?: string | null;
  event_start_date?: string | null;
  total_contacts?: number | null;
  event_location?: string | null;
  event_industry?: string | null;
}

/** The "gate" mode test: substantive AND timely AND complete. */
export function passesEventQualityGate(e: EventIndexInput): boolean {
  if ((e.total_contacts ?? 0) < EVENT_GATE.minContacts) return false;
  if (!e.event_location || !e.event_industry) return false;
  if (!e.event_start_date) return false;
  const start = new Date(e.event_start_date).getTime();
  if (Number.isNaN(start)) return false;
  const cutoff = Date.now() - EVENT_GATE.postEventGraceDays * 86_400_000;
  return start >= cutoff; // upcoming, or ended within the grace window
}

/** Whether an event page should be indexable, honoring the current mode. */
export function isEventIndexable(e: EventIndexInput): boolean {
  if (!e.event_slug) return false;
  if (EVENT_INDEX_MODE === "denylist") {
    return !NOINDEXED_SLUGS.has(e.event_slug);
  }
  return passesEventQualityGate(e);
}
