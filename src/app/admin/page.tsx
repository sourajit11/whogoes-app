import { createAdminClient } from "@/lib/supabase/admin";
import AdminOverview from "./admin-overview";

export default async function AdminDashboardPage() {
  const admin = createAdminClient();

  // Daily-granularity data for last 6 months (client filters by time range)
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 6);
  const startStr = startDate.toISOString().split("T")[0];
  const endStr = new Date().toISOString().split("T")[0];

  // All four are independent — run them together instead of one after another
  // (each is a separate cross-region round-trip to Supabase).
  const [
    { data: stats, error: statsError },
    { data: dashboardData, error: dashError },
    { data: recentCustomers, error: custError },
    { data: topEvents, error: evtError },
  ] = await Promise.all([
    admin.rpc("admin_get_business_stats"),
    admin.rpc("admin_get_dashboard_data", {
      p_start_date: startStr,
      p_end_date: endStr,
    }),
    admin
      .from("admin_customer_overview")
      .select("*")
      .order("signed_up_at", { ascending: false })
      .limit(10),
    admin
      .from("admin_event_popularity")
      .select("*")
      .order("subscriber_count", { ascending: false })
      .limit(5),
  ]);
  if (statsError) console.error("[admin] stats error:", statsError);
  if (dashError) console.error("[admin] dashboard data error:", dashError);
  if (custError) console.error("[admin] customers error:", custError);
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
      dashboardData={dashboardData ?? {
        daily_signups: [],
        daily_revenue: [],
        daily_credits: [],
        daily_active_users: [],
      }}
      recentCustomers={recentCustomers ?? []}
      topEvents={topEvents ?? []}
    />
  );
}
