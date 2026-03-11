import { createClient } from "@/lib/supabase/server";
import MyEventsView from "./my-events-view";

export default async function MyEventsPage() {
  const supabase = await createClient();

  const { data: subscribedEvents } = await supabase.rpc(
    "get_subscribed_events"
  );

  return <MyEventsView subscribedEvents={subscribedEvents ?? []} />;
}
