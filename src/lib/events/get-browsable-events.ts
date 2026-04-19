import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BrowsableEvent } from "@/types";

// Tag used to invalidate the cached browsable events list after admin mutations.
export const BROWSABLE_EVENTS_TAG = "events-browsable";

// Cached fetch of the base browsable events list — shared across ALL users.
// Returns `is_subscribed: false` for every event because it uses the admin client
// (no auth.uid() context). Authenticated pages should fetch the user's own
// subscribed event IDs separately and merge them in via `mergeSubscriptions()`.
export const getBrowsableEventsCached = unstable_cache(
  async (): Promise<BrowsableEvent[]> => {
    const adminClient = createAdminClient();

    const [eventsRes, slugsRes] = await Promise.all([
      adminClient.rpc("get_all_browsable_events"),
      adminClient.from("events").select("id, slug"),
    ]);

    if (eventsRes.error) {
      throw new Error(
        `Failed to fetch browsable events: ${eventsRes.error.message}`
      );
    }

    const slugMap = new Map(
      (slugsRes.data ?? []).map((s: { id: string; slug: string }) => [
        s.id,
        s.slug,
      ])
    );

    return (eventsRes.data ?? []).map((e: BrowsableEvent) => ({
      ...e,
      is_subscribed: false,
      event_slug: slugMap.get(e.event_id) ?? undefined,
    }));
  },
  ["browsable-events-cached-v1"],
  { revalidate: 3600, tags: [BROWSABLE_EVENTS_TAG] }
);

// Merge a user's subscribed event IDs into the cached list, flipping
// `is_subscribed` to true for events the user has unlocked.
export function mergeSubscriptions(
  events: BrowsableEvent[],
  subscribedEventIds: Set<string>
): BrowsableEvent[] {
  if (subscribedEventIds.size === 0) return events;
  return events.map((e) =>
    subscribedEventIds.has(e.event_id) ? { ...e, is_subscribed: true } : e
  );
}
