"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { BrowsableEvent } from "@/types";

interface EventsBrowserProps {
  initialEvents: BrowsableEvent[];
  credits: number;
  years: number[];
  regions: string[];
}

export default function EventsBrowser({
  initialEvents,
  credits,
  years,
  regions,
}: EventsBrowserProps) {
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [selectedRegion, setSelectedRegion] = useState<string>("");
  const [minContacts, setMinContacts] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const router = useRouter();

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
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.event_name.toLowerCase().includes(q) ||
          (e.event_location ?? "").toLowerCase().includes(q)
      );
    }

    // Sort: 1) Active first, 2) Most contacts, 3) Nearest date to today
    const now = Date.now();
    result = [...result].sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
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
  }, [initialEvents, selectedYear, selectedRegion, minContacts, searchQuery]);

  function handleCardClick(event: BrowsableEvent) {
    if (event.is_subscribed) {
      router.push(`/dashboard/my-events?event=${event.event_id}`);
    } else if (event.event_slug) {
      router.push(`/events/${event.event_slug}`);
    } else {
      router.push(`/dashboard/events/${event.event_id}`);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Browse Events
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Explore all tracked events and unlock contact data
      </p>

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

        <span className="ml-auto text-sm text-zinc-400">
          {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Event Cards Grid */}
      {filteredEvents.length === 0 ? (
        <div className="mt-12 flex h-48 items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700">
          <p className="text-sm text-zinc-400">
            No events match your filters
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredEvents.map((event) => (
            <EventCard
              key={event.event_id}
              event={event}
              onClick={() => handleCardClick(event)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({
  event,
  onClick,
}: {
  event: BrowsableEvent;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group cursor-pointer rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 w-full"
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
    </button>
  );
}
