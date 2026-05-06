import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import EventDetail from "./event-detail";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EventDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  // Check if user is authenticated (don't redirect - this is a public page)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Look up just this event — used to fetch the full browsable list (~456 rows)
  // every time, which crossed Supabase's statement_timeout on cold cache.
  const adminClient = createAdminClient();
  const [eventRowRes, countsRes] = await Promise.all([
    adminClient
      .from("events")
      .select("id, name, year, region, location, start_date, slug, is_active")
      .eq("id", id)
      .maybeSingle(),
    adminClient.rpc("get_event_unlock_status", { p_event_id: id }),
  ]);

  const eventRow = eventRowRes.data;
  if (!eventRow) {
    notFound();
  }

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
    const { data: creditsData } = await supabase.rpc("get_customer_credits");
    credits = creditsData ?? 0;

    const { data: statusData } = await supabase.rpc("get_event_unlock_status", {
      p_event_id: id,
    });
    unlockStatus = statusData ?? null;
  }

  return (
    <EventDetail
      event={event}
      credits={credits}
      isAuthenticated={!!user}
      unlockStatus={unlockStatus}
      userEmail={user?.email ?? undefined}
    />
  );
}
