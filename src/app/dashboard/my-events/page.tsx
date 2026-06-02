import { createClient } from "@/lib/supabase/server";
import MyEventsView from "./my-events-view";

export default async function MyEventsPage() {
  const supabase = await createClient();

  const { data: subscribedEvents, error } = await supabase.rpc(
    "get_subscribed_events"
  );
  // Distinguish a genuinely-empty list from a failed query so the view shows
  // Retry instead of the "Browse Events" empty state on a timeout.
  const loadError = !!error;

  return (
    <MyEventsView
      subscribedEvents={subscribedEvents ?? []}
      loadError={loadError}
    />
  );
}
