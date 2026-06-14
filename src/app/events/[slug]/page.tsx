import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import EventDetail from "@/app/dashboard/events/[id]/event-detail";
import EventSeoContent, {
  EventSeoFaqJsonLd,
  getEventFaqs,
} from "./event-seo-content";
import { getPostBySlug } from "@/lib/blog";
import { contentUrl } from "@/lib/site";
import { isEventIndexable } from "@/lib/events/indexing";
import type { BrowsableEvent, ContactPreview } from "@/types";

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
      url: contentUrl(`/events/${slug}`),
      type: "website",
      siteName: "WhoGoes",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    alternates: {
      canonical: contentUrl(`/events/${slug}`),
    },
  };

  // event_slug may be absent on the metadata fetch; the route param is the
  // authoritative slug, so pass it through for the denylist check.
  if (!isEventIndexable({ ...event, event_slug: slug })) {
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
    url: contentUrl(`/events/${event.event_slug}`),
    description: `Attendee list for ${event.event_name} with ${event.total_contacts.toLocaleString()} verified contacts.`,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    image: contentUrl(`/events/${event.event_slug}/opengraph-image`),
    organizer: {
      "@type": "Organization",
      name: "WhoGoes",
      url: "https://whogoes.co",
    },
    offers: {
      "@type": "Offer",
      url: contentUrl(`/events/${event.event_slug}`),
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
      { "@type": "ListItem", position: 2, name: "Events", item: contentUrl("/events") },
      { "@type": "ListItem", position: 3, name: `${eventName} Attendee List`, item: contentUrl(`/events/${slug}`) },
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

  // Auth + the event lookup are independent — run them together so we don't
  // pay two sequential cross-region (Supabase Tokyo) round-trips.
  const [userRes, eventsRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("get_event_by_slug", { p_slug: slug }),
  ]);

  const user = userRes.data.user;
  const event = eventsRes.data?.[0] as
    | (BrowsableEvent & { event_slug: string })
    | undefined;
  if (!event) notFound();

  // The 5-contact preview, credits and unlock status all depend on the
  // event_id we just resolved, but not on each other — fetch in parallel.
  // Rendering the preview server-side puts it straight into the HTML (no
  // post-hydration fetch, no "all blurred" flash) and helps SEO.
  //
  // The preview is public blurred sample data, so we fetch it with the admin
  // (service_role) client. Signed-out visitors otherwise hit Postgres as the
  // `anon` role, whose 3s statement_timeout aborts the RPC on a cold cache for
  // large events (error 57014 -> "preview took too long"). service_role has no
  // statement_timeout. Credits/unlock status stay on the user-scoped client
  // because they depend on auth.uid().
  const adminSupabase = createAdminClient();
  const [previewRes, creditsRes, statusRes] = await Promise.all([
    adminSupabase.rpc("get_event_preview", { p_event_id: event.event_id }),
    user ? supabase.rpc("get_customer_credits") : Promise.resolve({ data: null }),
    user
      ? supabase.rpc("get_event_unlock_status", { p_event_id: event.event_id })
      : Promise.resolve({ data: null }),
  ]);

  const initialPreviews = (previewRes.data ?? []) as ContactPreview[];
  const credits = user ? (creditsRes.data ?? 0) : 0;
  const unlockStatus = user ? (statusRes.data ?? null) : null;

  // Check if a matching blog post exists for this event
  const relatedPost = getPostBySlug(`${slug}-attendee-list`);
  const faqs = getEventFaqs(event);

  return (
    <>
      <EventJsonLd event={event} />
      <BreadcrumbJsonLd eventName={event.event_name} slug={event.event_slug} />
      <EventSeoFaqJsonLd faqs={faqs} />
      <EventDetail
        event={event}
        credits={credits}
        isAuthenticated={!!user}
        unlockStatus={unlockStatus}
        userEmail={user?.email ?? undefined}
        initialPreviews={initialPreviews}
      />
      <EventSeoContent
        event={event}
        previews={initialPreviews}
        hasBlog={!!relatedPost}
        blogSlug={relatedPost?.meta.slug}
        blogTitle={relatedPost?.meta.title}
      />
    </>
  );
}
