import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import Link from "next/link";
import EventDetail from "@/app/dashboard/events/[id]/event-detail";
import { getPostBySlug } from "@/lib/blog";
import type { BrowsableEvent } from "@/types";
import noindexedConfig from "@/config/noindexed-event-slugs.json";

const NOINDEXED_SLUGS = new Set<string>(noindexedConfig.slugs);

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const supabase = createAdminClient();
  const { data: events } = await supabase
    .from("events")
    .select("slug")
    .order("start_date", { ascending: false });

  return (events ?? []).map((event) => ({ slug: event.slug }));
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

  const metadata: Metadata = {
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

  if (NOINDEXED_SLUGS.has(slug)) {
    metadata.robots = { index: false, follow: true };
  }

  return metadata;
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
    image: `https://app.whogoes.co/events/${event.event_slug}/opengraph-image`,
    organizer: {
      "@type": "Organization",
      name: "WhoGoes",
      url: "https://whogoes.co",
    },
    offers: {
      "@type": "Offer",
      url: `https://app.whogoes.co/events/${event.event_slug}`,
      price: "29",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      validFrom: event.event_start_date ?? undefined,
    },
    performer: {
      "@type": "PerformingGroup",
      name: "Various Exhibitors & Speakers",
    },
  };

  if (event.event_start_date) {
    jsonLd.startDate = event.event_start_date;
    // Estimate endDate as startDate + 3 days (typical trade show duration)
    const start = new Date(event.event_start_date);
    const end = new Date(start);
    end.setDate(start.getDate() + 3);
    jsonLd.endDate = end.toISOString().split("T")[0];
  }
  if (event.event_location) {
    jsonLd.location = {
      "@type": "Place",
      name: event.event_location,
      address: {
        "@type": "PostalAddress",
        name: event.event_location,
      },
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

  // Check if a matching blog post exists for this event
  const relatedPost = getPostBySlug(`${slug}-attendee-list`);

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
      {relatedPost && (
        <div className="mx-auto max-w-4xl px-4 pb-12">
          <Link
            href={`/blog/${relatedPost.meta.slug}`}
            className="block rounded-lg border border-blue-200 bg-blue-50 p-4 transition-colors hover:bg-blue-100"
          >
            <p className="text-sm font-medium text-blue-900">
              Read our full guide
            </p>
            <p className="mt-1 text-blue-700">
              {relatedPost.meta.title}
            </p>
          </Link>
        </div>
      )}
    </>
  );
}
