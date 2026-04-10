import { createClient } from "@/lib/supabase/server";
import {
  getBrowsableEventsCached,
  mergeSubscriptions,
} from "@/lib/events/get-browsable-events";
import type { BrowsableEvent } from "@/types";
import EventsBrowser from "./events-browser";

export default async function EventsPage() {
  const supabase = await createClient();

  // Check auth (don't redirect — this is a public page)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let baseEvents: BrowsableEvent[] = [];
  let loadError = false;
  let credits = 0;
  let subscribedEventIds = new Set<string>();

  try {
    if (user) {
      // Fetch shared cached events list + per-user subscriptions + credits in parallel.
      const [events, subsRes, creditsRes] = await Promise.all([
        getBrowsableEventsCached(),
        supabase
          .from("customer_event_subscriptions")
          .select("event_id")
          .eq("user_id", user.id),
        supabase.rpc("get_customer_credits"),
      ]);

      baseEvents = events;
      subscribedEventIds = new Set(
        (subsRes.data ?? []).map((s: { event_id: string }) => s.event_id)
      );
      credits = (creditsRes.data as number | null) ?? 0;
    } else {
      baseEvents = await getBrowsableEventsCached();
    }
  } catch (err) {
    console.error("Failed to load dashboard events:", err);
    loadError = true;
  }

  const eventsWithSubscriptions = mergeSubscriptions(baseEvents, subscribedEventIds);

  // Extract unique years for the filter dropdown
  const years = [
    ...new Set(eventsWithSubscriptions.map((e) => e.event_year)),
  ].sort((a, b) => b - a);

  const regions = [
    ...new Set(
      eventsWithSubscriptions.map((e) => e.event_region).filter(Boolean)
    ),
  ].sort() as string[];

  return (
    <EventsBrowser
      initialEvents={eventsWithSubscriptions}
      credits={credits}
      years={years}
      regions={regions}
      isAuthenticated={!!user}
      loadError={loadError}
    />
  );
}
