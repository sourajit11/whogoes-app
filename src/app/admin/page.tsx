import { createAdminClient } from "@/lib/supabase/admin";
import AdminOverview from "./admin-overview";

export default async function AdminDashboardPage() {
  const admin = createAdminClient();

  // Aggregate lifetime stats
  const { data: stats, error: statsError } = await admin.rpc("admin_get_business_stats");
  if (statsError) console.error("[admin] stats error:", statsError);

  // Daily-granularity data for last 6 months (client filters by time range)
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 6);
  const startStr = startDate.toISOString().split("T")[0];
  const endStr = new Date().toISOString().split("T")[0];

  const { data: dashboardData, error: dashError } = await admin.rpc(
    "admin_get_dashboard_data",
    { p_start_date: startStr, p_end_date: endStr }
  );
  if (dashError) console.error("[admin] dashboard data error:", dashError);

  // Recent signups
  const { data: recentCustomers, error: custError } = await admin
    .from("admin_customer_overview")
    .select("*")
    .order("signed_up_at", { ascending: false })
    .limit(10);
  if (custError) console.error("[admin] customers error:", custError);

  // Top events
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
