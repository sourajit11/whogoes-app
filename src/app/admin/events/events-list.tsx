"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { AdminEventPopularity } from "@/types/admin";

interface EventsListProps {
  events: AdminEventPopularity[];
}

type FilterStatus = "all" | "active" | "inactive";

export default function EventsList({ events }: EventsListProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");

  const filtered = useMemo(() => {
    let result = events;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((e) => e.event_name.toLowerCase().includes(q));
    }
    if (statusFilter === "active") {
      result = result.filter((e) => e.is_active);
    } else if (statusFilter === "inactive") {
      result = result.filter((e) => !e.is_active);
    }
    return result;
  }, [events, search, statusFilter]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Events
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        {events.length} total events
      </p>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search events..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
        />
        <div className="flex rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
          {(["all", "active", "inactive"] as FilterStatus[]).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`cursor-pointer px-3 py-2 text-xs font-medium capitalize transition-colors ${
                statusFilter === status
                  ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
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
                Subscribers
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Unlocks
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Contacts
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                W/ Email
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-zinc-400">
                  {search || statusFilter !== "all" ? "No events match your filters" : "No events yet"}
                </td>
              </tr>
            ) : (
              filtered.map((event) => (
                <tr
                  key={event.event_id}
                  className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                >
                  <td className="px-4 py-3.5">
                    <Link
                      href={`/admin/events/${event.event_id}`}
                      className="font-medium text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
                    >
                      {event.event_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 text-zinc-500">
                    {event.event_year}
                  </td>
                  <td className="px-4 py-3.5">
                    {event.is_active ? (
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
                    {event.subscriber_count}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums text-zinc-500">
                    {event.total_unlocks.toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums text-zinc-500">
                    {event.total_contacts.toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums text-zinc-500">
                    {event.contacts_with_email.toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
