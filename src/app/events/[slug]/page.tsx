import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import EventDetail from "@/app/dashboard/events/[id]/event-detail";
import type { BrowsableEvent } from "@/types";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: events } = await supabase.rpc("get_event_by_slug", {
    p_slug: slug,
  });

  const event = events?.[0];
  if (!event) return { title: "Event Not Found" };

  const title = `${event.event_name} Attendee List — ${event.total_contacts.toLocaleString()} Verified Contacts`;
  const nameIncludesYear = event.event_name.includes(String(event.event_year));
  const eventLabel = nameIncludesYear
    ? event.event_name
    : `${event.event_name} ${event.event_year}`;
  const description = `Get the ${eventLabel} attendee list. ${event.total_contacts.toLocaleString()} contacts with LinkedIn proof${
    event.contacts_with_email > 0
      ? `, ${event.contacts_with_email.toLocaleString()} with verified email`
      : ""
  }.${event.event_location ? ` Location: ${event.event_location}.` : ""}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `https://app.whogoes.co/events/${slug}`,
      type: "article",
      siteName: "WhoGoes",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    alternates: {
      canonical: `https://app.whogoes.co/events/${slug}`,
    },
  };
}

function EventJsonLd({
  event,
}: {
  event: {
    event_name: string;
    event_start_date: string | null;
    event_location: string | null;
    event_slug: string;
    total_contacts: number;
  };
}) {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.event_name,
    url: `https://app.whogoes.co/events/${event.event_slug}`,
    description: `Attendee list for ${event.event_name} with ${event.total_contacts.toLocaleString()} verified contacts.`,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    organizer: {
      "@type": "Organization",
      name: "WhoGoes",
      url: "https://whogoes.co",
    },
  };

  if (event.event_start_date) {
    jsonLd.startDate = event.event_start_date;
  }
  if (event.event_location) {
    jsonLd.location = {
      "@type": "Place",
      name: event.event_location,
    };
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

function BreadcrumbJsonLd({ eventName, slug }: { eventName: string; slug: string }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://whogoes.co" },
      { "@type": "ListItem", position: 2, name: "Events", item: "https://app.whogoes.co/events" },
      { "@type": "ListItem", position: 3, name: `${eventName} Attendee List`, item: `https://app.whogoes.co/events/${slug}` },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default async function PublicEventDetailPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();

  // Check auth (don't redirect — public page)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: events } = await supabase.rpc("get_event_by_slug", {
    p_slug: slug,
  });

  const event = events?.[0] as BrowsableEvent & { event_slug: string } | undefined;
  if (!event) notFound();

  // Only fetch credits and unlock status if authenticated
  let credits = 0;
  let unlockStatus = null;
  if (user) {
    const { data: creditsData } = await supabase.rpc("get_customer_credits");
    credits = creditsData ?? 0;

    const { data: statusData } = await supabase.rpc("get_event_unlock_status", {
      p_event_id: event.event_id,
    });
    unlockStatus = statusData ?? null;
  }

  return (
    <>
      <EventJsonLd event={event} />
      <BreadcrumbJsonLd eventName={event.event_name} slug={event.event_slug} />
      <EventDetail
        event={event}
        credits={credits}
        isAuthenticated={!!user}
        unlockStatus={unlockStatus}
        userEmail={user?.email ?? undefined}
      />
    </>
  );
}
