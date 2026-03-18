"use client";

import Link from "next/link";
import type { DashboardOverview, SubscribedEvent } from "@/types";
import StatCard from "./components/stat-card";
import EmptyState from "./components/empty-state";

interface OverviewProps {
  overview: DashboardOverview;
  subscribedEvents: SubscribedEvent[];
}

export default function Overview({
  overview,
  subscribedEvents,
}: OverviewProps) {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Dashboard
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Overview of your event attendee data
      </p>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Events Tracked"
          value={overview.total_events_tracked}
        />
        <StatCard
          label="Live Events"
          value={overview.live_events}
          accent="emerald"
          subtitle="Actively collecting data"
        />
        <StatCard
          label="Unlocked Events"
          value={overview.subscribed_events}
          accent="blue"
        />
        <StatCard
          label="Contacts Unlocked"
          value={overview.total_accessible_contacts}
        />
      </div>

      {/* Subscribed Events */}
      <div className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            My Unlocked Events
          </h2>
          {subscribedEvents.length > 0 && (
            <Link
              href="/dashboard/my-events"
              className="text-sm font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
            >
              View all
            </Link>
          )}
        </div>

        {subscribedEvents.length === 0 ? (
          <EmptyState
            title="No unlocked events yet"
            description="Browse events to find and unlock attendee data."
            icon={
              <svg
                className="h-8 w-8 text-zinc-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            }
          >
            <Link
              href="/dashboard/events"
              className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
            >
              Browse Events
            </Link>
          </EmptyState>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Event
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Year
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Unlocked
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    New Leads
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                {subscribedEvents.map((event) => (
                  <tr
                    key={event.event_id}
                    className="cursor-pointer transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                  >
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/dashboard/my-events?event=${event.event_id}`}
                        className="font-medium text-zinc-900 hover:text-emerald-600 dark:text-zinc-100 dark:hover:text-emerald-400"
                      >
                        {event.event_name}
                      </Link>
                      {event.event_location && (
                        <p className="text-xs text-zinc-400">
                          {event.event_location}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-zinc-500">
                      {event.event_year}
                    </td>
                    <td className="px-4 py-3.5">
                      {event.is_paused ? (
                        <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/10 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20">
                          Paused
                        </span>
                      ) : event.is_active ? (
                        <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/10 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-500/10 dark:bg-zinc-500/10 dark:text-zinc-400 dark:ring-zinc-500/20">
                          Completed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-zinc-500">
                      {(event.new_contacts + event.processed_contacts).toLocaleString()}
                      <span className="text-zinc-300 dark:text-zinc-600"> / </span>
                      {event.total_contacts.toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5">
                      {event.new_contacts > 0 ? (
                        <Link
                          href={`/dashboard/my-events?event=${event.event_id}`}
                          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {event.new_contacts} new
                        </Link>
                      ) : (
                        <span className="text-xs text-zinc-400">
                          Up to date
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
