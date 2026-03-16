import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import EventDetail from "./event-detail";

export default async function AdminEventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  // Get event info
  const { data: event } = await admin
    .from("events")
    .select("*")
    .eq("id", id)
    .single();

  if (!event) notFound();

  // Get data quality for this event
  const { data: quality } = await admin
    .from("admin_data_quality")
    .select("*")
    .eq("event_id", id)
    .single();

  // Get subscribers
  const { data: subscribers } = await admin
    .from("customer_event_subscriptions")
    .select("user_id, subscribed_at, is_paused")
    .eq("event_id", id);

  // Get subscriber emails from auth
  const subscriberIds = subscribers?.map((s) => s.user_id) ?? [];
  let subscriberDetails: { user_id: string; email: string; subscribed_at: string; is_paused: boolean; unlocks: number }[] = [];

  if (subscriberIds.length > 0) {
    const { data: users } = await admin.auth.admin.listUsers();
    const userMap = new Map(users?.users?.map((u) => [u.id, u.email]) ?? []);

    // Get unlock counts per user for this event
    const { data: unlockCounts } = await admin
      .from("customer_contact_access")
      .select("user_id")
      .eq("event_id", id);

    const unlockMap = new Map<string, number>();
    unlockCounts?.forEach((u) => {
      unlockMap.set(u.user_id, (unlockMap.get(u.user_id) ?? 0) + 1);
    });

    subscriberDetails = (subscribers ?? []).map((s) => ({
      user_id: s.user_id,
      email: userMap.get(s.user_id) ?? "Unknown",
      subscribed_at: s.subscribed_at,
      is_paused: s.is_paused,
      unlocks: unlockMap.get(s.user_id) ?? 0,
    }));
  }

  return (
    <EventDetail
      event={event}
      quality={quality}
      subscribers={subscriberDetails}
    />
  );
}
