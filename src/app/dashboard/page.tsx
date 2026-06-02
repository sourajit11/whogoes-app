import { createClient } from "@/lib/supabase/server";
import Overview from "./overview";

export default async function DashboardPage() {
  const supabase = await createClient();

  // These two are independent — run them together to avoid a sequential
  // cross-region (Supabase Tokyo) round-trip.
  const [overviewRes, subscribedRes] = await Promise.all([
    supabase.rpc("get_dashboard_overview"),
    supabase.rpc("get_subscribed_events"),
  ]);

  // A failed query (often a cross-region timeout) used to fall through to an
  // empty/zeroed dashboard that looked like "nothing here". Flag it so the
  // user sees a Retry instead.
  const loadError = !!overviewRes.error || !!subscribedRes.error;

  return (
    <Overview
      overview={
        overviewRes.data ?? {
          total_events_tracked: 0,
          live_events: 0,
          subscribed_events: 0,
          total_accessible_contacts: 0,
        }
      }
      subscribedEvents={subscribedRes.data ?? []}
      loadError={loadError}
    />
  );
}
