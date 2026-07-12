import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound, redirect } from "next/navigation";
import EventDetail from "./event-detail";
import type { Facets } from "./event-filters";
import type { ContactPreview } from "@/types";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EventDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const adminClient = createAdminClient();

  // Run all event-independent lookups together to avoid a cross-region
  // (Supabase Tokyo) request waterfall: auth, the event row, public counts,
  // and the 5-contact preview (server-rendered so it lands in the HTML).
  const [userRes, eventRowRes, countsRes, previewRes] = await Promise.all([
    supabase.auth.getUser(),
    adminClient
      .from("events")
      .select("id, name, year, region, location, start_date, slug, is_active, is_whogoes_active, industry, facets_cache")
      .eq("id", id)
      .maybeSingle(),
    adminClient.rpc("get_event_unlock_status", { p_event_id: id }),
    adminClient.rpc("get_event_preview", { p_event_id: id }),
  ]);

  const user = userRes.data.user;
  const eventRow = eventRowRes.data;
  if (!eventRow) {
    notFound();
  }

  const initialPreviews = (previewRes.data ?? []) as ContactPreview[];
  const initialFacets = (eventRow.facets_cache ?? null) as Facets | null;

  const counts = countsRes.data as {
    total_contacts?: number;
    contacts_with_email?: number;
  } | null;

  const event = {
    event_id: eventRow.id,
    event_name: eventRow.name,
    event_year: eventRow.year,
    event_region: eventRow.region,
    event_location: eventRow.location,
    event_start_date: eventRow.start_date,
    event_industry: eventRow.industry ?? null,
    event_slug: eventRow.slug,
    is_active: eventRow.is_active,
    is_whogoes_active: eventRow.is_whogoes_active,
    total_contacts: counts?.total_contacts ?? 0,
    contacts_with_email: counts?.contacts_with_email ?? 0,
    is_subscribed: false,
  };

  // Only fetch credits and unlock status if authenticated
  let credits = 0;
  let unlockStatus = null;
  let apiEligible = false;
  let hasApiKey = false;
  let initialSubscription: {
    auto_unlock_enabled: boolean;
    max_unlocks_per_event: number | null;
  } | null = null;

  if (user) {
    // These three depend only on the user, so fetch them together.
    const [creditsRes, statusRes, eligibleRes] = await Promise.all([
      supabase.rpc("get_customer_credits"),
      supabase.rpc("get_event_unlock_status", { p_event_id: id }),
      supabase.rpc("is_api_eligible", { p_user_id: user.id }),
    ]);
    credits = creditsRes.data ?? 0;
    unlockStatus = statusRes.data ?? null;
    apiEligible = !!eligibleRes.data;

    // Subscribed users manage this event (and unlock more) from My Events — same
    // behavior as the Browse Events grid, now also for direct links.
    if ((unlockStatus as { is_subscribed?: boolean } | null)?.is_subscribed) {
      redirect(`/dashboard/my-events?event=${id}`);
    }

    if (apiEligible) {
      const [keyCountRes, subRowRes] = await Promise.all([
        supabase
          .from("api_keys")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_active", true),
        supabase
          .from("customer_event_subscriptions")
          .select("auto_unlock_enabled, max_unlocks_per_event")
          .eq("user_id", user.id)
          .eq("event_id", id)
          .maybeSingle(),
      ]);
      hasApiKey = (keyCountRes.count ?? 0) > 0;
      if (subRowRes.data) {
        initialSubscription = {
          auto_unlock_enabled: subRowRes.data.auto_unlock_enabled,
          max_unlocks_per_event: subRowRes.data.max_unlocks_per_event,
        };
      }
    }
  }

  return (
    <EventDetail
      event={event}
      credits={credits}
      isAuthenticated={!!user}
      unlockStatus={unlockStatus}
      userEmail={user?.email ?? undefined}
      apiEligible={apiEligible}
      hasApiKey={hasApiKey}
      initialSubscription={initialSubscription}
      initialPreviews={initialPreviews}
      initialFacets={initialFacets}
    />
  );
}
