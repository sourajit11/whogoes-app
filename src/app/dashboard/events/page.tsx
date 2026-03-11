import { createClient } from "@/lib/supabase/server";
import EventsBrowser from "./events-browser";

export default async function EventsPage() {
  const supabase = await createClient();

  // Check auth (don't redirect — this is a public page)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: events } = await supabase.rpc("get_all_browsable_events");

  // Only fetch credits if authenticated
  let credits = 0;
  if (user) {
    const { data: creditsData } = await supabase.rpc("get_customer_credits");
    credits = creditsData ?? 0;
  }

  // Extract unique years for the filter dropdown
  const eventsArr = (events ?? []) as Array<{ event_year: number; event_region: string | null }>;
  const years = [...new Set(eventsArr.map((e) => e.event_year))].sort(
    (a, b) => b - a
  );

  const regions = [
    ...new Set(eventsArr.map((e) => e.event_region).filter(Boolean)),
  ].sort() as string[];

  return (
    <EventsBrowser
      initialEvents={events ?? []}
      credits={credits ?? 0}
      years={years as number[]}
      regions={regions as string[]}
    />
  );
}
