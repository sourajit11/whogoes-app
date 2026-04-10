"use client";

import { useState, useMemo, useDeferredValue, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BrowsableEvent } from "@/types";

const PAGE_SIZE = 60;

interface EventsBrowserProps {
  initialEvents: BrowsableEvent[];
  credits: number;
  years: number[];
  regions: string[];
  isAuthenticated?: boolean;
  loadError?: boolean;
}

export default function EventsBrowser({
  initialEvents,
  credits,
  years,
  regions,
  isAuthenticated,
  loadError = false,
}: EventsBrowserProps) {
  const router = useRouter();
  const [isRefreshing, startRefreshing] = useTransition();
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedRegion, setSelectedRegion] = useState<string>("");
  const [minContacts, setMinContacts] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Capture "now" once at mount so the sort inside useMemo stays pure.
  const [now] = useState(() => Date.now());

  // Defer search query so fast typing doesn't block re-renders on slow devices.
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Reset pagination when filters change — using the "adjust state during render"
  // pattern (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const filterKey = `${selectedYear}|${selectedRegion}|${minContacts}|${statusFilter}|${deferredSearchQuery}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setVisibleCount(PAGE_SIZE);
  }

  const hasActiveFilters =
    !!selectedYear ||
    !!selectedRegion ||
    !!minContacts ||
    !!statusFilter ||
    !!searchQuery.trim();

  function clearFilters() {
    setSelectedYear("");
    setSelectedRegion("");
    setMinContacts("");
    setStatusFilter("");
    setSearchQuery("");
  }

  const filteredEvents = useMemo(() => {
    let result = initialEvents;

    if (selectedYear) {
      result = result.filter((e) => e.event_year === Number(selectedYear));
    }
    if (selectedRegion) {
      result = result.filter((e) => e.event_region === selectedRegion);
    }
    if (minContacts) {
      result = result.filter(
        (e) => e.total_contacts >= Number(minContacts)
      );
    }
    if (statusFilter === "active") {
      result = result.filter((e) => e.is_active);
    } else if (statusFilter === "completed") {
      result = result.filter((e) => !e.is_active);
    }
    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.event_name.toLowerCase().includes(q) ||
          (e.event_location ?? "").toLowerCase().includes(q)
      );
    }

    // Sort: 1) Most contacts (highest first), 2) Nearest date to today
    result = [...result].sort((a, b) => {
      if (a.total_contacts !== b.total_contacts)
        return b.total_contacts - a.total_contacts;
      const dateA = a.event_start_date
        ? Math.abs(new Date(a.event_start_date).getTime() - now)
        : Infinity;
      const dateB = b.event_start_date
        ? Math.abs(new Date(b.event_start_date).getTime() - now)
        : Infinity;
      return dateA - dateB;
    });

    return result;
  }, [initialEvents, selectedYear, selectedRegion, minContacts, deferredSearchQuery, statusFilter, now]);

  const visibleEvents = filteredEvents.slice(0, visibleCount);
  const hasMore = filteredEvents.length > visibleCount;

  function getEventHref(event: BrowsableEvent): string {
    if (event.is_subscribed) {
      return `/dashboard/my-events?event=${event.event_id}`;
    }
    // Authenticated users stay in dashboard layout (where sidebar credits update)
    if (isAuthenticated) {
      return `/dashboard/events/${event.event_id}`;
    }
    // Unauthenticated users go to SEO-friendly public route
    if (event.event_slug) {
      return `/events/${event.event_slug}`;
    }
    return `/dashboard/events/${event.event_id}`;
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Browse Events
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Explore all tracked events and unlock contact data
      </p>

      {/* Load error banner — shown when the server-side fetch failed but the
          page still rendered. Keeps filters visible and gives a retry path. */}
      {loadError && (
        <div
          role="alert"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/20 dark:bg-amber-500/10"
        >
          <div className="flex items-start gap-2">
            <svg
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <div>
              <p className="font-medium text-amber-900 dark:text-amber-200">
                We couldn&apos;t load the latest events
              </p>
              <p className="mt-0.5 text-amber-800/80 dark:text-amber-300/80">
                Check your connection and try again.
              </p>
            </div>
          </div>
          <button
            onClick={() => startRefreshing(() => router.refresh())}
            disabled={isRefreshing}
            className="cursor-pointer rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-500 dark:hover:bg-amber-400"
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search events..."
            className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 sm:max-w-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>

        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 shadow-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          <option value="">All Years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <select
          value={selectedRegion}
          onChange={(e) => setSelectedRegion(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 shadow-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          <option value="">All Regions</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <select
          value={minContacts}
          onChange={(e) => setMinContacts(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 shadow-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          <option value="">Any Size</option>
          <option value="10">10+ contacts</option>
          <option value="50">50+ contacts</option>
          <option value="100">100+ contacts</option>
          <option value="200">200+ contacts</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 shadow-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
        </select>

        <span className="ml-auto text-sm text-zinc-400">
          {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Event Cards Grid */}
      {filteredEvents.length === 0 ? (
        <div className="mt-12 flex h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700">
          <p className="text-sm text-zinc-400">
            {initialEvents.length === 0 && !loadError
              ? "No events available yet. Check back soon."
              : "No events match your filters"}
          </p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="cursor-pointer rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleEvents.map((event) => (
              <EventCard
                key={event.event_id}
                event={event}
                href={getEventHref(event)}
              />
            ))}
          </div>
          {hasMore && (
            <div className="mt-8 flex justify-center">
              <button
                onClick={() =>
                  setVisibleCount((c) => c + PAGE_SIZE)
                }
                className="cursor-pointer rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Load more ({filteredEvents.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EventCard({
  event,
  href,
}: {
  event: BrowsableEvent;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group cursor-pointer rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 w-full block"
    >
      {/* Header: name + badges */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold leading-snug text-zinc-900 dark:text-zinc-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
          {event.event_name}
        </h3>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {event.is_active ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/10 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Active
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-500/10 dark:bg-zinc-500/10 dark:text-zinc-400 dark:ring-zinc-500/20">
              Completed
            </span>
          )}
          {event.is_subscribed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-600/10 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20">
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Unlocked
            </span>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="mt-3 space-y-1 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <span className="font-medium text-zinc-500 dark:text-zinc-400">
            {event.event_year}
          </span>
          {event.event_region && (
            <>
              <span>·</span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {event.event_region}
              </span>
            </>
          )}
        </div>
        {event.event_start_date && (
          <p className="flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {new Date(event.event_start_date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        )}
        {event.event_location && (
          <p className="flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5 shrink-0 text-zinc-300 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {event.event_location}
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="mt-4 flex items-center gap-5 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <div className="flex items-center gap-1.5">
          <svg className="h-4 w-4 text-zinc-300 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-sm">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {event.total_contacts.toLocaleString()}
            </span>
            <span className="ml-1 text-zinc-400">contacts</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg className="h-4 w-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span className="text-sm">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {event.contacts_with_email.toLocaleString()}
            </span>
            <span className="ml-1 text-zinc-400">emails</span>
          </span>
        </div>
        <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          <svg className="h-4 w-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
