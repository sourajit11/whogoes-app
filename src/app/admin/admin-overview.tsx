"use client";

import Link from "next/link";
import StatCard from "@/app/dashboard/components/stat-card";
import type { AdminBusinessStats, AdminCustomer, AdminEventPopularity } from "@/types/admin";

interface AdminOverviewProps {
  stats: AdminBusinessStats;
  recentCustomers: AdminCustomer[];
  topEvents: AdminEventPopularity[];
}

export default function AdminOverview({
  stats,
  recentCustomers,
  topEvents,
}: AdminOverviewProps) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Admin Dashboard
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Business overview and key metrics
      </p>

      {/* Stats Grid */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total Users"
          value={stats.total_users}
          accent="indigo"
        />
        <StatCard
          label="New This Month"
          value={stats.users_this_month}
          accent="indigo"
          subtitle="User signups"
        />
        <StatCard
          label="Credits Consumed"
          value={stats.total_credits_consumed}
        />
        <StatCard
          label="Credits This Month"
          value={stats.credits_this_month}
          accent="blue"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard
          label="Total Events"
          value={stats.total_events}
        />
        <StatCard
          label="Active Events"
          value={stats.active_events}
          accent="emerald"
        />
        <StatCard
          label="Total Contacts"
          value={stats.total_contacts}
        />
      </div>

      {/* Two-column layout: Recent Customers + Top Events */}
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
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-zinc-400">
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
                    <td colSpan={3} className="px-4 py-8 text-center text-sm text-zinc-400">
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
