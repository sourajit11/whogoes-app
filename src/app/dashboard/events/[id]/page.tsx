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

  // Use admin client for public data — anon key can fail for unauthenticated users
  const adminClient = createAdminClient();
  const { data: events } = await adminClient.rpc("get_all_browsable_events");
  const event = (events ?? []).find(
    (e: { event_id: string }) => e.event_id === id
  );

  if (!event) {
    notFound();
  }

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
