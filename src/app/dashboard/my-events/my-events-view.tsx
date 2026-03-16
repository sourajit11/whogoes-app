"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SubscribedEvent, Contact, SortKey, SortDir } from "@/types";
import ContactTable from "./contact-table";
import DownloadControls from "./download-controls";
import EmptyState from "../components/empty-state";
import Link from "next/link";

interface MyEventsViewProps {
  subscribedEvents: SubscribedEvent[];
}

type TabFilter = "all" | "new" | "processed";

const PAGE_SIZE = 50;

export default function MyEventsView({
  subscribedEvents,
}: MyEventsViewProps) {
  const searchParams = useSearchParams();
  const initialEventId = searchParams.get("event") ?? "";

  const [selectedEventId, setSelectedEventId] = useState(initialEventId);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [emailOnly, setEmailOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("post_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [eventSearch, setEventSearch] = useState("");
  const [eventFilter, setEventFilter] = useState<"all" | "active" | "completed">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const supabase = createClient();
  const selectedEvent = subscribedEvents.find(
    (e) => e.event_id === selectedEventId
  );

  // Filter events for the card grid
  const filteredEvents = useMemo(() => {
    let result = subscribedEvents;

    if (eventFilter === "active") {
      result = result.filter((e) => e.is_active);
    } else if (eventFilter === "completed") {
      result = result.filter((e) => !e.is_active);
    }

    if (eventSearch.trim()) {
      const q = eventSearch.toLowerCase();
      result = result.filter(
        (e) =>
          e.event_name.toLowerCase().includes(q) ||
          (e.event_location ?? "").toLowerCase().includes(q) ||
          (e.event_region ?? "").toLowerCase().includes(q)
      );
    }

    return result;
  }, [subscribedEvents, eventFilter, eventSearch]);

  const fetchContacts = useCallback(async () => {
    if (!selectedEventId) return;
    setLoading(true);

    const allContacts: Contact[] = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: batch, error } = await supabase
        .rpc("get_subscribed_event_contacts", {
          p_event_id: selectedEventId,
          p_filter: "all",
        })
        .range(from, from + batchSize - 1);

      if (error) {
        console.error("Error fetching contacts:", error);
        setLoading(false);
        return;
      }

      allContacts.push(...(batch ?? []));
      hasMore = (batch?.length ?? 0) === batchSize;
      from += batchSize;
    }

    setContacts(allContacts);
    setPage(0);
    setLoading(false);
  }, [selectedEventId, supabase]);

  useEffect(() => {
    if (selectedEventId) {
      fetchContacts();
    }
  }, [selectedEventId, fetchContacts]);

  const filteredContacts = useMemo(() => {
    let result = contacts;

    if (activeTab === "new") {
      result = result.filter((c) => !c.is_downloaded);
    } else if (activeTab === "processed") {
      result = result.filter((c) => c.is_downloaded);
    }

    if (emailOnly) {
      result = result.filter((c) => c.email);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          (c.full_name ?? "").toLowerCase().includes(q) ||
          (c.current_title ?? "").toLowerCase().includes(q) ||
          (c.company_name ?? "").toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q) ||
          (c.city ?? "").toLowerCase().includes(q) ||
          (c.country ?? "").toLowerCase().includes(q)
      );
    }

    // Sort all filtered contacts before pagination
    result = [...result].sort((a, b) => {
      if (sortKey === "post_date") {
        const aTime = a.post_date ? new Date(a.post_date).getTime() : 0;
        const bTime = b.post_date ? new Date(b.post_date).getTime() : 0;
        return sortDir === "asc" ? aTime - bTime : bTime - aTime;
      }
      const aVal = (a[sortKey] ?? "").toString().toLowerCase();
      const bVal = (b[sortKey] ?? "").toString().toLowerCase();
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [contacts, activeTab, emailOnly, searchQuery, sortKey, sortDir]);

  const paginatedContacts = filteredContacts.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE
  );
  const totalPages = Math.ceil(filteredContacts.length / PAGE_SIZE);

  const newCount = contacts.filter((c) => !c.is_downloaded).length;
  const processedCount = contacts.filter((c) => c.is_downloaded).length;

  const selectedContacts = filteredContacts.filter((c) =>
    selectedIds.has(c.contact_id)
  );

  function handleContactsDownloaded(downloadedIds: string[]) {
    setContacts((prev) =>
      prev.map((c) =>
        downloadedIds.includes(c.contact_id)
          ? { ...c, is_downloaded: true, downloaded_at: new Date().toISOString() }
          : c
      )
    );
  }

  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleToggleAll(ids: string[]) {
    setSelectedIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  if (subscribedEvents.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Unlocked Events
        </h1>
        <EmptyState
          title="No unlocked events"
          description="Unlock events to start accessing contact data."
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
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
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
      </div>
    );
  }

  // If no event is selected, show the card grid
  if (!selectedEventId) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Unlocked Events
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          View and download contacts from your unlocked events
        </p>

        {/* Filters */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={eventSearch}
            onChange={(e) => setEventSearch(e.target.value)}
            placeholder="Search events..."
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 sm:max-w-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />

          <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            {(["all", "active", "completed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setEventFilter(f)}
                className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  eventFilter === f
                    ? "bg-zinc-900 text-white dark:bg-zinc-700"
                    : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <span className="ml-auto text-sm text-zinc-400">
            {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Event Cards */}
        {filteredEvents.length === 0 ? (
          <div className="mt-12 flex h-48 items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700">
            <p className="text-sm text-zinc-400">
              No events match your filters
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredEvents.map((event) => (
              <button
                key={event.event_id}
                onClick={() => {
                  setSelectedEventId(event.event_id);
                  setActiveTab("all");
                  setSearchQuery("");
                  setPage(0);
                  setSelectedIds(new Set());
                }}
                className="cursor-pointer rounded-2xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
              >
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {event.event_name}
                  </h3>
                  {event.is_paused ? (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/10 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20">
                      Paused
                    </span>
                  ) : event.is_active ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/10 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-500/10 dark:bg-zinc-500/10 dark:text-zinc-400 dark:ring-zinc-500/20">
                      Completed
                    </span>
                  )}
                </div>

                <div className="mt-2 space-y-1 text-xs text-zinc-400">
                  <p>{event.event_year}{event.event_region ? ` · ${event.event_region}` : ""}</p>
                  {event.event_location && <p>{event.event_location}</p>}
                </div>

                <div className="mt-4 flex items-center gap-4 text-sm">
                  <div>
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      {(event.new_contacts + event.processed_contacts).toLocaleString()}
                    </span>
                    <span className="ml-1 text-zinc-400">
                      of {event.total_contacts.toLocaleString()} unlocked
                    </span>
                  </div>
                  {event.new_contacts > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {event.new_contacts}
                      </span>
                      <span className="text-zinc-400">new</span>
                    </div>
                  )}
                </div>

                {/* Unlock progress bar */}
                {(() => {
                  const unlocked = event.new_contacts + event.processed_contacts;
                  const pct = event.total_contacts > 0 ? (unlocked / event.total_contacts) * 100 : 0;
                  const remaining = event.total_contacts - unlocked;
                  return (
                    <>
                      <div className="mt-3 h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-700">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-zinc-400">
                        {remaining > 0
                          ? `${remaining.toLocaleString()} more available`
                          : "All contacts unlocked"}
                      </p>
                    </>
                  );
                })()}

                {/* Unlock More link for partially unlocked events */}
                {(event.new_contacts + event.processed_contacts) < event.total_contacts && (
                  <Link
                    href={`/dashboard/events/${event.event_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 transition-colors hover:text-emerald-500 dark:text-emerald-400"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Unlock more contacts
                  </Link>
                )}

                {(event.new_contacts + event.processed_contacts) >= event.total_contacts && (
                  <div className="mt-2 text-xs text-zinc-400">
                    Unlocked {new Date(event.subscribed_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Event selected — show contacts view
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Back to events */}
      <button
        onClick={() => {
          setSelectedEventId("");
          setContacts([]);
        }}
        className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Unlocked Events
      </button>

      <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {selectedEvent?.event_name ?? "Event"}
      </h1>

      {selectedEvent && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-zinc-500">
          {selectedEvent.event_start_date && (
            <span className="flex items-center gap-1.5">
              <svg className="h-4 w-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {new Date(selectedEvent.event_start_date).toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          )}
          {selectedEvent.event_location && (
            <span className="flex items-center gap-1.5">
              <svg className="h-4 w-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {selectedEvent.event_location}
            </span>
          )}
          {selectedEvent.event_region && (
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {selectedEvent.event_region}
            </span>
          )}
          {selectedEvent.is_active ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/10 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              Actively Collecting Data
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-500/10 dark:bg-zinc-500/10 dark:text-zinc-400 dark:ring-zinc-500/20">
              Data Collection Complete
            </span>
          )}
        </div>
      )}

      {loading && (
        <div className="mt-12 flex h-48 items-center justify-center">
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <svg
              className="h-5 w-5 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Loading contacts...
          </div>
        </div>
      )}

      {!loading && (
        <>
          {/* Stats row */}
          {selectedEvent && (
            <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-zinc-500">
              <span>
                <strong className="text-blue-600 dark:text-blue-400">
                  {contacts.length.toLocaleString()}
                </strong>
                <span className="mx-1">of</span>
                <strong className="text-zinc-900 dark:text-zinc-100">
                  {selectedEvent.total_contacts.toLocaleString()}
                </strong>{" "}
                unlocked
              </span>
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              <span>
                <strong className="text-emerald-600 dark:text-emerald-400">
                  {newCount.toLocaleString()}
                </strong>{" "}
                new
              </span>
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              <span>
                <strong className="text-zinc-500">
                  {processedCount.toLocaleString()}
                </strong>{" "}
                processed
              </span>
              {contacts.length < selectedEvent.total_contacts && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-600">·</span>
                  <Link
                    href={`/dashboard/events/${selectedEvent.event_id}`}
                    className="inline-flex items-center gap-1 font-medium text-emerald-600 transition-colors hover:text-emerald-500 dark:text-emerald-400"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Unlock more
                  </Link>
                </>
              )}
            </div>
          )}

          {/* Unlock More Banner */}
          {selectedEvent && contacts.length < selectedEvent.total_contacts && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/50 px-5 py-4 dark:border-emerald-800/50 dark:bg-emerald-900/10">
              <div>
                <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                  {(selectedEvent.total_contacts - contacts.length).toLocaleString()} more contacts available for this event
                </p>
                <p className="mt-0.5 text-xs text-emerald-600/70 dark:text-emerald-400/60">
                  Unlock more contacts to expand your lead list
                </p>
              </div>
              <Link
                href={`/dashboard/events/${selectedEvent.event_id}`}
                className="shrink-0 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
              >
                Unlock →
              </Link>
            </div>
          )}

          {/* Tabs */}
          <div className="mt-4 flex items-center gap-2">
            {(["all", "new", "processed"] as TabFilter[]).map((tab) => {
              const count =
                tab === "all"
                  ? contacts.length
                  : tab === "new"
                    ? newCount
                    : processedCount;
              return (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab);
                    setPage(0);
                    setSelectedIds(new Set());
                  }}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? tab === "new"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                        : "bg-zinc-900 text-white dark:bg-zinc-700"
                      : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {tab === "new" && (
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  )}
                  {tab.charAt(0).toUpperCase() + tab.slice(1)} ({count})
                </button>
              );
            })}
          </div>

          {/* Toolbar */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 sm:max-w-xs">
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
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="Search name, company, title, email..."
                className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>

            <button
              onClick={() => {
                setEmailOnly(!emailOnly);
                setPage(0);
              }}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                emailOnly
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
              }`}
            >
              With email only
            </button>

            <DownloadControls
              contacts={filteredContacts}
              eventName={selectedEvent?.event_name ?? "contacts"}
              eventId={selectedEventId}
              activeTab={activeTab}
              selectedContacts={selectedContacts}
              onDownloaded={handleContactsDownloaded}
              onClearSelection={() => setSelectedIds(new Set())}
            />
          </div>

          {/* Table */}
          <div className="mt-4">
            <ContactTable
              contacts={paginatedContacts}
              startIndex={page * PAGE_SIZE}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={(key) => {
                if (sortKey === key) {
                  setSortDir(sortDir === "asc" ? "desc" : "asc");
                } else {
                  setSortKey(key);
                  setSortDir("asc");
                }
                setPage(0);
              }}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onToggleAll={handleToggleAll}
            />
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-zinc-400">
                Page {page + 1} of {totalPages} ·{" "}
                {filteredContacts.length.toLocaleString()} contacts
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="cursor-pointer rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  Previous
                </button>
                <button
                  onClick={() =>
                    setPage((p) => Math.min(totalPages - 1, p + 1))
                  }
                  disabled={page >= totalPages - 1}
                  className="cursor-pointer rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
