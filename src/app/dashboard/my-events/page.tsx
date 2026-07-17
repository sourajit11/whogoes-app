import { createClient } from "@/lib/supabase/server";
import MyEventsView from "./my-events-view";

export default async function MyEventsPage() {
  const supabase = await createClient();

  // Auth and the subscribed-events list are independent — fetch together.
  const [userRes, subscribedRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("get_subscribed_events"),
  ]);
  const user = userRes.data.user;
  const subscribedEvents = subscribedRes.data;
  // Distinguish a genuinely-empty list from a failed query so the view shows
  // Retry instead of the "Browse Events" empty state on a timeout.
  const loadError = !!subscribedRes.error;

  let apiEligible = false;
  let hasApiKey = false;
  const subscriptionsByEvent: Record<
    string,
    { auto_unlock_enabled: boolean; max_unlocks_per_event: number | null }
  > = {};

  if (user) {
    // Eligibility and the subscription rows depend only on the user.
    const [eligibleRes, subRowsRes] = await Promise.all([
      supabase.rpc("is_api_eligible", { p_user_id: user.id }),
      supabase
        .from("customer_event_subscriptions")
        .select("event_id, auto_unlock_enabled, max_unlocks_per_event")
        .eq("user_id", user.id),
    ]);
    apiEligible = !!eligibleRes.data;

    if (apiEligible) {
      const { count: keyCount } = await supabase
        .from("api_keys")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_active", true);
      hasApiKey = (keyCount ?? 0) > 0;
    }

    for (const row of subRowsRes.data ?? []) {
      subscriptionsByEvent[row.event_id] = {
        auto_unlock_enabled: row.auto_unlock_enabled,
        max_unlocks_per_event: row.max_unlocks_per_event,
      };
    }
  }

  return (
    <MyEventsView
      subscribedEvents={subscribedEvents ?? []}
      apiEligible={apiEligible}
      hasApiKey={hasApiKey}
      subscriptionsByEvent={subscriptionsByEvent}
      loadError={loadError}
    />
  );
}
