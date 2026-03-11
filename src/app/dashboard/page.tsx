import { createClient } from "@/lib/supabase/server";
import Overview from "./overview";

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: overview } = await supabase.rpc("get_dashboard_overview");
  const { data: subscribedEvents } = await supabase.rpc(
    "get_subscribed_events"
  );

  return (
    <Overview
      overview={
        overview ?? {
          total_events_tracked: 0,
          live_events: 0,
          subscribed_events: 0,
          total_accessible_contacts: 0,
        }
      }
      subscribedEvents={subscribedEvents ?? []}
    />
  );
}
