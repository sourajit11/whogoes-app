import { createAdminClient } from "@/lib/supabase/admin";
import EventsList from "./events-list";

export default async function AdminEventsPage() {
  const admin = createAdminClient();

  const { data: events } = await admin
    .from("admin_event_popularity")
    .select("*")
    .order("subscriber_count", { ascending: false });

  return <EventsList events={events ?? []} />;
}
