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

  // Event info, data quality, and subscribers are independent — fetch together.
  const [{ data: event }, { data: quality }, { data: subscribers }] =
    await Promise.all([
      admin.from("events").select("*").eq("id", id).single(),
      admin.from("admin_data_quality").select("*").eq("event_id", id).single(),
      admin
        .from("customer_event_subscriptions")
        .select("user_id, subscribed_at, is_paused")
        .eq("event_id", id),
    ]);

  if (!event) notFound();

  // Get subscriber emails from auth
  const subscriberIds = subscribers?.map((s) => s.user_id) ?? [];
  let subscriberDetails: { user_id: string; email: string; subscribed_at: string; is_paused: boolean; unlocks: number }[] = [];

  if (subscriberIds.length > 0) {
    const [{ data: users }, { data: unlockCounts }] = await Promise.all([
      admin.auth.admin.listUsers(),
      admin
        .from("customer_contact_access")
        .select("user_id")
        .eq("event_id", id),
    ]);
    const userMap = new Map(users?.users?.map((u) => [u.id, u.email]) ?? []);

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
