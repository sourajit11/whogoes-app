import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import EventDetail from "./event-detail";
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
      .select("id, name, year, region, location, start_date, slug, is_active, industry")
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
    total_contacts: counts?.total_contacts ?? 0,
    contacts_with_email: counts?.contacts_with_email ?? 0,
    is_subscribed: false,
  };

  // Only fetch credits and unlock status if authenticated
  let credits = 0;
  let unlockStatus = null;

  if (user) {
    // Both depend only on the user, so fetch them together.
    const [creditsRes, statusRes] = await Promise.all([
      supabase.rpc("get_customer_credits"),
      supabase.rpc("get_event_unlock_status", { p_event_id: id }),
    ]);
    credits = creditsRes.data ?? 0;
    unlockStatus = statusRes.data ?? null;
  }

  return (
    <EventDetail
      event={event}
      credits={credits}
      isAuthenticated={!!user}
      unlockStatus={unlockStatus}
      userEmail={user?.email ?? undefined}
      initialPreviews={initialPreviews}
    />
  );
}
