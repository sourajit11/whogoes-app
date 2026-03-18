"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type {
  AdminBusinessStats,
  AdminCustomer,
  AdminEventPopularity,
  DashboardData,
  TimeRange,
} from "@/types/admin";
import KpiCard from "./components/kpi-card";
import TimeRangeFilter from "./components/time-range-filter";
import SimpleChart from "./components/simple-chart";
import StatCard from "@/app/dashboard/components/stat-card";

interface CeoDashboardProps {
  stats: AdminBusinessStats;
  dashboardData: DashboardData;
  recentCustomers: AdminCustomer[];
  topEvents: AdminEventPopularity[];
}

// --- Helpers ---

function getDateRange(range: TimeRange): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  switch (range) {
    case "today":
      break;
    case "7d":
      start.setDate(start.getDate() - 6);
      break;
    case "4w":
      start.setDate(start.getDate() - 27);
      break;
    case "3m":
      start.setMonth(start.getMonth() - 3);
      break;
    case "all":
      start.setFullYear(2020);
      break;
  }
  return { start, end };
}

function getPreviousDateRange(range: TimeRange): { start: Date; end: Date } {
  const current = getDateRange(range);
  const durationMs = current.end.getTime() - current.start.getTime();
  return {
    start: new Date(current.start.getTime() - durationMs - 1),
    end: new Date(current.start.getTime() - 1),
  };
}

function filterByRange<T extends { date: string }>(
  data: T[],
  range: { start: Date; end: Date }
): T[] {
  return data.filter((d) => {
    const date = new Date(d.date + "T00:00:00");
    return date >= range.start && date <= range.end;
  });
}

function sumField<T>(data: T[], field: keyof T): number {
  return data.reduce((acc, item) => acc + (Number(item[field]) || 0), 0);
}

function calculateChange(current: number, previous: number): number | undefined {
  if (previous === 0) return current > 0 ? 100 : undefined;
  return Math.round(((current - previous) / previous) * 100);
}

function comparisonLabel(range: TimeRange): string {
  switch (range) {
    case "today":
      return "vs yesterday";
    case "7d":
      return "vs previous 7 days";
    case "4w":
      return "vs previous 4 weeks";
    case "3m":
      return "vs previous 3 months";
    case "all":
      return "";
  }
}

function formatDateLabel(dateStr: string, range: TimeRange): string {
  const date = new Date(dateStr + "T00:00:00");
  if (range === "today") return "Today";
  if (range === "7d")
    return date.toLocaleDateString("en", { weekday: "short" });
  if (range === "3m" || range === "all")
    return date.toLocaleDateString("en", { month: "short", day: "numeric" });
  return date.toLocaleDateString("en", { month: "short", day: "numeric" });
}

export default function AdminOverview({
  stats,
  dashboardData,
  recentCustomers,
  topEvents,
}: CeoDashboardProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");

  const computed = useMemo(() => {
    const currentRange = getDateRange(timeRange);
    const prevRange = getPreviousDateRange(timeRange);

    // Filter data for current and previous periods
    const curSignups = filterByRange(dashboardData.daily_signups, currentRange);
    const prevSignups = filterByRange(dashboardData.daily_signups, prevRange);

    const curRevenue = filterByRange(dashboardData.daily_revenue, currentRange);
    const prevRevenue = filterByRange(dashboardData.daily_revenue, prevRange);

    const curCredits = filterByRange(dashboardData.daily_credits, currentRange);
    const prevCredits = filterByRange(dashboardData.daily_credits, prevRange);

    const curActiveUsers = filterByRange(dashboardData.daily_active_users, currentRange);
    const prevActiveUsers = filterByRange(dashboardData.daily_active_users, prevRange);

    // Sums for current period
    const signupsTotal = sumField(curSignups, "count");
    const revenueTotal = sumField(curRevenue, "revenue");
    const creditsTotal = sumField(curCredits, "credits_consumed");
    const activeUsersTotal = sumField(curActiveUsers, "active_users");

    // Sums for previous period
    const prevSignupsTotal = sumField(prevSignups, "count");
    const prevRevenueTotal = sumField(prevRevenue, "revenue");
    const prevCreditsTotal = sumField(prevCredits, "credits_consumed");
    const prevActiveUsersTotal = sumField(prevActiveUsers, "active_users");

    // Chart data
    const signupsChart = curSignups.map((d) => ({
      label: formatDateLabel(d.date, timeRange),
      value: d.count,
    }));

    const revenueChart = curRevenue.map((d) => ({
      label: formatDateLabel(d.date, timeRange),
      value: Number(d.revenue),
    }));

    const creditsChart = curCredits.map((d) => ({
      label: formatDateLabel(d.date, timeRange),
      value: d.credits_consumed,
    }));

    const activeUsersChart = curActiveUsers.map((d) => ({
      label: formatDateLabel(d.date, timeRange),
      value: d.active_users,
    }));

    return {
      signupsTotal,
      revenueTotal,
      creditsTotal,
      activeUsersTotal,
      signupsChange: calculateChange(signupsTotal, prevSignupsTotal),
      revenueChange: calculateChange(revenueTotal, prevRevenueTotal),
      creditsChange: calculateChange(creditsTotal, prevCreditsTotal),
      activeUsersChange: calculateChange(activeUsersTotal, prevActiveUsersTotal),
      signupsChart,
      revenueChart,
      creditsChart,
      activeUsersChart,
    };
  }, [dashboardData, timeRange]);

  const comparison = comparisonLabel(timeRange);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Header + Time Filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Admin Dashboard
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Business overview and key metrics
          </p>
        </div>
        <TimeRangeFilter value={timeRange} onChange={setTimeRange} />
      </div>

      {/* KPI Cards — filtered by time range */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="New Signups"
          value={computed.signupsTotal}
          changePercent={computed.signupsChange}
          comparisonLabel={comparison}
          accent="indigo"
        />
        <KpiCard
          label="Revenue"
          value={computed.revenueTotal}
          prefix="$"
          changePercent={computed.revenueChange}
          comparisonLabel={comparison}
          accent="emerald"
        />
        <KpiCard
          label="Credits Used"
          value={computed.creditsTotal}
          changePercent={computed.creditsChange}
          comparisonLabel={comparison}
          accent="blue"
        />
        <KpiCard
          label="Active Users"
          value={computed.activeUsersTotal}
          changePercent={computed.activeUsersChange}
          comparisonLabel={comparison}
          accent="amber"
        />
      </div>

      {/* Lifetime Totals — not affected by filter */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Users" value={stats.total_users} />
        <StatCard label="Total Events" value={stats.total_events} />
        <StatCard
          label="Active Events"
          value={stats.active_events}
          accent="emerald"
        />
        <StatCard label="Total Contacts" value={stats.total_contacts} />
      </div>

      {/* Charts */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            User Signups
          </h3>
          <p className="mb-4 text-xs text-zinc-400">
            New registrations per day
          </p>
          <SimpleChart
            data={computed.signupsChart}
            color="#8b5cf6"
            type="area"
          />
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Revenue
          </h3>
          <p className="mb-4 text-xs text-zinc-400">
            Payment revenue per day (USD)
          </p>
          <SimpleChart
            data={computed.revenueChart}
            color="#10b981"
            type="bar"
            formatYAxis={(v) => `$${v}`}
          />
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Credits Consumed
          </h3>
          <p className="mb-4 text-xs text-zinc-400">
            Contacts unlocked per day
          </p>
          <SimpleChart
            data={computed.creditsChart}
            color="#6366f1"
            type="bar"
          />
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Daily Active Users
          </h3>
          <p className="mb-4 text-xs text-zinc-400">
            Unique users who unlocked contacts
          </p>
          <SimpleChart
            data={computed.activeUsersChart}
            color="#3b82f6"
            type="line"
          />
        </div>
      </div>

      {/* Tables: Recent Signups + Top Events */}
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {/* Recent Signups */}
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Recent Signups
            </h2>
            <Link
              href="/admin/customers"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
            >
              View all
            </Link>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Email
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Credits
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Signed Up
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                {recentCustomers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-8 text-center text-sm text-zinc-400"
                    >
                      No customers yet
                    </td>
                  </tr>
                ) : (
                  recentCustomers.map((customer) => (
                    <tr
                      key={customer.user_id}
                      className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/customers/${customer.user_id}`}
                          className="font-medium text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
                        >
                          {customer.email}
                        </Link>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-zinc-500">
                        {customer.credit_balance}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {new Date(customer.signed_up_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Events */}
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Top Events
            </h2>
            <Link
              href="/admin/events"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
            >
              View all
            </Link>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Event
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Subscribers
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Unlocks
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                {topEvents.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-8 text-center text-sm text-zinc-400"
                    >
                      No events yet
                    </td>
                  </tr>
                ) : (
                  topEvents.map((event) => (
                    <tr
                      key={event.event_id}
                      className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/events/${event.event_id}`}
                          className="font-medium text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
                        >
                          {event.event_name}
                        </Link>
                        <p className="text-xs text-zinc-400">
                          {event.total_contacts.toLocaleString()} contacts
                        </p>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-zinc-500">
                        {event.subscriber_count}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-zinc-500">
                        {event.total_unlocks.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
