import { createAdminClient } from "@/lib/supabase/admin";
import AnalyticsView from "./analytics-view";

export default async function AdminAnalyticsPage() {
  const admin = createAdminClient();

  // Monthly revenue/usage data
  const { data: revenueSummary } = await admin
    .from("admin_revenue_summary")
    .select("*")
    .order("month", { ascending: true });

  // User signup data (aggregate by month)
  const { data: allUsers } = await admin.auth.admin.listUsers();
  const signupsByMonth: Record<string, number> = {};
  allUsers?.users?.forEach((u) => {
    const month = new Date(u.created_at).toISOString().slice(0, 7);
    signupsByMonth[month] = (signupsByMonth[month] ?? 0) + 1;
  });
  const signupData = Object.entries(signupsByMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

  // Top events by unlocks
  const { data: topEvents } = await admin
    .from("admin_event_popularity")
    .select("event_name, total_unlocks")
    .order("total_unlocks", { ascending: false })
    .limit(10);

  return (
    <AnalyticsView
      revenueSummary={
        revenueSummary?.map((r) => ({
          month: new Date(r.month).toISOString().slice(0, 7),
          credits_consumed: r.credits_consumed,
          active_users: r.active_users,
          events_accessed: r.events_accessed,
        })) ?? []
      }
      signupData={signupData}
      topEvents={
        topEvents?.map((e) => ({
          event_name: e.event_name,
          total_unlocks: e.total_unlocks,
        })) ?? []
      }
    />
  );
}
