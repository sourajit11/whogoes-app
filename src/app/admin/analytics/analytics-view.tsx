"use client";

import SimpleChart from "../components/simple-chart";

interface AnalyticsViewProps {
  revenueSummary: {
    month: string;
    credits_consumed: number;
    active_users: number;
    events_accessed: number;
  }[];
  signupData: { month: string; count: number }[];
  topEvents: { event_name: string; total_unlocks: number }[];
}

export default function AnalyticsView({
  revenueSummary,
  signupData,
  topEvents,
}: AnalyticsViewProps) {
  // Format month labels (e.g., "2025-03" -> "Mar 25")
  function formatMonth(m: string) {
    const [year, month] = m.split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[parseInt(month) - 1]} ${year.slice(2)}`;
  }

  const creditsChartData = revenueSummary.map((r) => ({
    label: formatMonth(r.month),
    value: r.credits_consumed,
  }));

  const activeUsersChartData = revenueSummary.map((r) => ({
    label: formatMonth(r.month),
    value: r.active_users,
  }));

  const signupChartData = signupData.map((s) => ({
    label: formatMonth(s.month),
    value: s.count,
  }));

  const topEventsChartData = topEvents
    .filter((e) => e.total_unlocks > 0)
    .map((e) => ({
      label: e.event_name.length > 25 ? e.event_name.slice(0, 22) + "..." : e.event_name,
      value: e.total_unlocks,
    }));

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Analytics
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Revenue, usage, and growth trends
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {/* Credits Consumed */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Monthly Credits Consumed
          </h3>
          <p className="mb-4 text-xs text-zinc-400">
            Total contacts unlocked per month
          </p>
          <SimpleChart data={creditsChartData} color="#6366f1" type="bar" />
        </div>

        {/* Monthly Active Users */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Monthly Active Users
          </h3>
          <p className="mb-4 text-xs text-zinc-400">
            Users who unlocked at least one contact
          </p>
          <SimpleChart data={activeUsersChartData} color="#10b981" type="line" />
        </div>

        {/* User Signups */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            User Signups
          </h3>
          <p className="mb-4 text-xs text-zinc-400">
            New user registrations per month
          </p>
          <SimpleChart data={signupChartData} color="#8b5cf6" type="area" />
        </div>

        {/* Top Events by Unlocks */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Top Events by Unlocks
          </h3>
          <p className="mb-4 text-xs text-zinc-400">
            Most popular events by total contacts unlocked
          </p>
          <SimpleChart data={topEventsChartData} color="#f59e0b" type="bar" />
        </div>
      </div>
    </div>
  );
}
