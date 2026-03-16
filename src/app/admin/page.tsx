import { createAdminClient } from "@/lib/supabase/admin";
import AdminOverview from "./admin-overview";

export default async function AdminDashboardPage() {
  const admin = createAdminClient();

  const { data: stats, error: statsError } = await admin.rpc("admin_get_business_stats");
  if (statsError) console.error("[admin] stats error:", statsError);

  const { data: recentCustomers, error: custError } = await admin
    .from("admin_customer_overview")
    .select("*")
    .order("signed_up_at", { ascending: false })
    .limit(10);
  if (custError) console.error("[admin] customers error:", custError);

  const { data: topEvents, error: evtError } = await admin
    .from("admin_event_popularity")
    .select("*")
    .order("subscriber_count", { ascending: false })
    .limit(5);
  if (evtError) console.error("[admin] events error:", evtError);

  return (
    <AdminOverview
      stats={stats ?? {
        total_users: 0,
        users_this_month: 0,
        total_credits_consumed: 0,
        credits_this_month: 0,
        total_events: 0,
        active_events: 0,
        total_contacts: 0,
      }}
      recentCustomers={recentCustomers ?? []}
      topEvents={topEvents ?? []}
    />
  );
}
