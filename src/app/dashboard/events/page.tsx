import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import EventsBrowser from "./events-browser";

export default async function EventsPage() {
  const supabase = await createClient();

  // Check auth (don't redirect — this is a public page)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Use user's supabase client so auth.uid() works inside RPC (for is_subscribed)
  // Admin client would lose user context and is_subscribed would always be false
  const adminClient = createAdminClient();
  const { data: events, error: eventsError } = await supabase.rpc("get_all_browsable_events");
  if (eventsError) {
    console.error("Failed to fetch browsable events:", eventsError.message);
  }
  const { data: slugs } = await adminClient.from("events").select("id, slug");
  const slugMap = new Map((slugs ?? []).map((s: { id: string; slug: string }) => [s.id, s.slug]));

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

  // Merge slugs into events for /events/[slug] navigation
  const eventsWithSlugs = (events ?? []).map((e: { event_id: string }) => ({
    ...e,
    event_slug: slugMap.get(e.event_id) ?? undefined,
  }));

  return (
    <EventsBrowser
      initialEvents={eventsWithSlugs}
      credits={credits ?? 0}
      years={years as number[]}
      regions={regions as string[]}
      isAuthenticated={!!user}
    />
  );
}
