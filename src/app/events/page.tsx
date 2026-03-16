import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import EventsBrowser from "@/app/dashboard/events/events-browser";
import type { BrowsableEvent } from "@/types";

export const metadata: Metadata = {
  title: "Browse Trade Show & Event Attendee Lists",
  description:
    "Browse 1,200+ trade show and conference attendee lists with LinkedIn proof. Filter by year, region, and event size. Free preview for every event.",
  openGraph: {
    title: "Browse Trade Show & Event Attendee Lists",
    description:
      "Browse 1,200+ trade show and conference attendee lists with LinkedIn proof. Filter by year, region, and event size.",
    url: "https://app.whogoes.co/events",
  },
  alternates: {
    canonical: "https://app.whogoes.co/events",
  },
};

function EventsListJsonLd({
  events,
}: {
  events: Array<{ event_name: string; event_slug?: string }>;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Trade Show & Event Attendee Lists",
    description:
      "Browse trade show and conference attendee lists with LinkedIn proof.",
    numberOfItems: events.length,
    itemListElement: events
      .filter((e) => e.event_slug)
      .slice(0, 50)
      .map((event, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `https://app.whogoes.co/events/${event.event_slug}`,
        name: `${event.event_name} Attendee List`,
      })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default async function PublicEventsPage() {
  const supabase = await createClient();

  // Fetch browsable events via existing RPC
  const { data: events } = await supabase.rpc("get_all_browsable_events");

  // Fetch slug mapping using admin client (anon key can't read events table due to RLS)
  const adminClient = createAdminClient();
  const { data: slugs } = await adminClient
    .from("events")
    .select("id, slug");

  const slugMap = new Map(
    (slugs ?? []).map((s: { id: string; slug: string }) => [s.id, s.slug])
  );

  // Merge slugs into events
  const eventsWithSlugs: BrowsableEvent[] = (events ?? []).map(
    (e: BrowsableEvent) => ({
      ...e,
      event_slug: slugMap.get(e.event_id) ?? undefined,
    })
  );

  const years = [
    ...new Set(eventsWithSlugs.map((e) => e.event_year)),
  ].sort((a, b) => b - a);

  const regions = [
    ...new Set(
      eventsWithSlugs.map((e) => e.event_region).filter(Boolean)
    ),
  ].sort() as string[];

  return (
    <>
      <EventsListJsonLd events={eventsWithSlugs} />
      <EventsBrowser
        initialEvents={eventsWithSlugs}
        credits={0}
        years={years}
        regions={regions}
      />
    </>
  );
}
