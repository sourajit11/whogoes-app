"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SubscribedEvent, Contact, SortKey, SortDir, UnlockResult, UnlockBatch } from "@/types";
import ContactTable from "./contact-table";
import DownloadControls from "./download-controls";
import EmptyState from "../components/empty-state";
import UnlockConfirmModal from "../components/unlock-confirm-modal";
import ConfirmDialog from "../components/confirm-dialog";
import EventFilters, {
  cleanFilters,
  isFilterActive,
  describeFilters,
  type EventFiltersValue,
} from "../events/[id]/event-filters";
import Link from "next/link";

interface MyEventsViewProps {
  subscribedEvents: SubscribedEvent[];
  apiEligible?: boolean;
  hasApiKey?: boolean;
  subscriptionsByEvent?: Record<
    string,
    { auto_unlock_enabled: boolean; max_unlocks_per_event: number | null }
  >;
  loadError?: boolean;
}

type TabFilter = "all" | "new" | "processed";

const PAGE_SIZE = 50;

export default function MyEventsView({
  subscribedEvents,
  apiEligible = false,
  hasApiKey = false,
  subscriptionsByEvent = {},
  loadError = false,
}: MyEventsViewProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialEventId = searchParams.get("event") ?? "";

  const [selectedEventId, setSelectedEventId] = useState(initialEventId);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  // True once the selected event has loaded at least once. Distinguishes the
  // first full-height loader from later filter re-fetches (which keep the table
  // mounted under an overlay). Reset whenever the event changes.
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  // True only during a filter-driven reload, AFTER the table already had rows but
  // BEFORE the first batch of the new result arrives — drives the "Updating results…"
  // overlay so the old rows stay visible (no blank flash) until we can swap them.
  const [refetching, setRefetching] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [contactsError, setContactsError] = useState(false);
  // Monotonic token to cancel superseded loads. Rapid event/filter changes bump it;
  // any in-flight loop whose token no longer matches bails out before touching state,
  // so a stale stream can't pollute the current result.
  const loadTokenRef = useRef(0);
  // Mirror of initialLoadDone readable synchronously inside the async loop (state is
  // stale there). Lets a load tell whether it's an initial load or a refetch.
  const initialLoadDoneRef = useRef(false);
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [emailOnly, setEmailOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("post_date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [eventSearch, setEventSearch] = useState("");
  const [eventFilter, setEventFilter] = useState<"all" | "active" | "completed">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showUnlockPanel, setShowUnlockPanel] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockProgress, setUnlockProgress] = useState(0);
  const [unlockTarget, setUnlockTarget] = useState(0);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockSuccess, setUnlockSuccess] = useState<string | null>(null);
  // Non-null while the unlock confirmation modal is open (same pattern as the
  // event page — every unlock path confirms before spending credits).
  const [confirmUnlock, setConfirmUnlock] = useState<{ ignoreFilters?: boolean } | null>(null);
  // Contact ids whose processed toggle is being saved (prevents double toggles).
  const [togglingProcessed, setTogglingProcessed] = useState<Set<string>>(new Set());
  // Non-null while the "mark processed leads as new" confirmation is open.
  // Marking processed is one click; UNmarking clears the date, so it confirms.
  const [confirmMarkNew, setConfirmMarkNew] = useState<string[] | null>(null);
  // Non-null while the email-reveal confirmation is open (ids to reveal).
  // Reveals spend 1 credit each, so single and bulk both confirm first.
  const [confirmReveal, setConfirmReveal] = useState<string[] | null>(null);
  const [sliderIndex, setSliderIndex] = useState(0);
  const [revealingIds, setRevealingIds] = useState<Set<string>>(new Set());
  const [revealingAll, setRevealingAll] = useState(false);
  // ICP filters scope the owned-contact table, the "unlock more" count and the
  // bulk email reveal — same jsonb contract and component as the Browse Events page.
  const [icpFilters, setIcpFilters] = useState<EventFiltersValue>({});
  const [matchedCount, setMatchedCount] = useState<number | null>(null);
  // Server-side count of matches the user already owns (from the facets RPC).
  const [ownedMatched, setOwnedMatched] = useState<number | null>(null);
  const icpActive = isFilterActive(icpFilters);
  // Unlock history for the selected event (which filters produced which batch).
  const [unlockBatches, setUnlockBatches] = useState<UnlockBatch[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // Programmatic filter application from the history panel.
  const [externalFilters, setExternalFilters] = useState<EventFiltersValue | null>(null);
  const [externalKey, setExternalKey] = useState(0);
  // Bumped after each unlock so the filter bar refetches matched/owned counts.
  const [facetsRefreshKey, setFacetsRefreshKey] = useState(0);
  // Stringify-then-parse so cleanIcp keeps a STABLE identity across re-renders that
  // don't change the filter content. EventFilters fires onChange with a fresh {}
  // object on mount/refresh; without this, the fetch effect would re-run on every
  // such call and the page flickers between loading and loaded.
  const cleanIcpKey = JSON.stringify(cleanFilters(icpFilters));
  const cleanIcp = useMemo(
    () => JSON.parse(cleanIcpKey) as EventFiltersValue,
    [cleanIcpKey]
  );

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

    // Cancel any load still running and claim this one.
    const token = ++loadTokenRef.current;
    // Refetch = the table already has rows (event unchanged, filter changed). We keep
    // those rows on screen under an overlay until the first new batch arrives, then swap.
    const isRefetch = initialLoadDoneRef.current;

    setLoading(true);
    setContactsError(false);
    if (isRefetch) {
      setRefetching(true);
    } else {
      setContacts([]);
      setLoadedCount(0);
    }

    // Progressive load: paint the first page immediately, then stream the rest in the
    // background. The RPC limits the access rows before the heavy joins, so each page
    // stays under the statement timeout even on large events (a bare .range() recomputes
    // the full result every page and timed out at ~6,700 contacts). A small first batch
    // gets rows on screen in one round-trip instead of waiting for the whole event.
    const FIRST_BATCH = 50;
    const BATCH_SIZE = 1000;
    const accumulated: Contact[] = [];
    let from = 0;
    let firstBatch = true;
    let hasMore = true;

    while (hasMore) {
      const size = firstBatch ? FIRST_BATCH : BATCH_SIZE;
      const { data: batch, error } = await supabase.rpc(
        "get_subscribed_event_contacts",
        {
          p_event_id: selectedEventId,
          p_filter: "all",
          p_limit: size,
          p_offset: from,
          p_filters: cleanIcp,
          // Sort is pushed to the server so batches stream in display order — each
          // batch only appends rows below what's shown, so the page never reshuffles.
          p_sort_key: sortKey,
          p_sort_dir: sortDir,
        }
      );

      // A newer load (event/filter change) superseded this one — bail before touching state.
      if (token !== loadTokenRef.current) return;

      if (error) {
        console.error("Error fetching contacts:", error);
        setContactsError(true);
        setRefetching(false);
        setLoading(false);
        return;
      }

      const rows = (batch ?? []) as Contact[];
      accumulated.push(...rows);
      setContacts([...accumulated]);
      setLoadedCount(accumulated.length);

      if (firstBatch) {
        // First page is on screen now: drop the full-height loader / refetch overlay.
        setPage(0);
        setRefetching(false);
        setInitialLoadDone(true);
        initialLoadDoneRef.current = true;
        firstBatch = false;
      }

      hasMore = rows.length === size;
      from += size;
    }

    if (token !== loadTokenRef.current) return;
    setLoading(false);
  }, [selectedEventId, supabase, cleanIcp, sortKey, sortDir]);

  useEffect(() => {
    if (selectedEventId) {
      fetchContacts();
    }
  }, [selectedEventId, fetchContacts]);

  // Reset the first-load flag when the selected event changes so the new event
  // shows its full-height loader rather than overlaying a stale table.
  useEffect(() => {
    setInitialLoadDone(false);
    initialLoadDoneRef.current = false;
  }, [selectedEventId]);

  // The contact table is the densest view in the app: ask the sidebar to
  // collapse while an event is open and restore it on the way out.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("sidebar-collapse", {
        detail: { collapsed: Boolean(selectedEventId) },
      })
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("sidebar-collapse", { detail: { collapsed: false } })
      );
    };
  }, [selectedEventId]);

  // Fetch credits for inline unlock
  useEffect(() => {
    async function fetchCredits() {
      const { data } = await supabase.rpc("get_customer_credits");
      setCredits(data ?? 0);
    }
    fetchCredits();
  }, [supabase]);

  // Unlock history for the selected event (RLS scopes rows to the current user).
  const fetchBatches = useCallback(async () => {
    if (!selectedEventId) {
      setUnlockBatches([]);
      return;
    }
    const { data } = await supabase
      .from("unlock_batches")
      .select("id, event_id, filters, requested_count, unlocked_count, created_at")
      .eq("event_id", selectedEventId)
      .order("created_at", { ascending: false });
    setUnlockBatches((data ?? []) as UnlockBatch[]);
  }, [selectedEventId, supabase]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  // Computed values for inline unlock slider. When a filter is active, the
  // remaining pool is the contacts that MATCH the filter but aren't owned yet.
  // ownedMatched is the server-side owned count from the facets RPC — unlike
  // contacts.length it is correct even while the table is still streaming in.
  const remainingForEvent = selectedEvent
    ? icpActive && matchedCount !== null
      ? Math.max(0, matchedCount - (ownedMatched ?? contacts.length))
      : Math.max(
          0,
          selectedEvent.total_contacts -
            (selectedEvent.new_contacts + selectedEvent.processed_contacts)
        )
    : 0;

  const maxUnlock = Math.min(credits ?? 0, remainingForEvent);

  // Whole-event remaining pool regardless of active filters: an unfiltered unlock
  // that takes all of it qualifies for the full-list deal (emails included).
  const remainingWholeEvent = selectedEvent
    ? Math.max(
        0,
        selectedEvent.total_contacts -
          (selectedEvent.new_contacts + selectedEvent.processed_contacts)
      )
    : 0;

  const unlockSliderSteps = useMemo(() => {
    if (maxUnlock <= 0) return [];
    if (maxUnlock <= 10) return [maxUnlock];
    const steps: number[] = [];
    for (let i = 10; i < maxUnlock; i += 10) steps.push(i);
    steps.push(maxUnlock);
    return steps;
  }, [maxUnlock]);

  // Exact-count override typed into the number input (slider steps by 10s).
  const [customUnlockCount, setCustomUnlockCount] = useState<number | null>(null);
  const unlockSliderValue =
    customUnlockCount !== null
      ? Math.min(Math.max(1, customUnlockCount), maxUnlock)
      : (unlockSliderSteps[sliderIndex] ?? maxUnlock);

  // An unfiltered unlock that takes every remaining contact of the event
  // qualifies for the full-list deal: verified emails included free.
  const fullListSelected =
    !icpActive && remainingWholeEvent > 0 && unlockSliderValue >= remainingWholeEvent;

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

    // No client-side sort: the server returns rows already in the chosen sort order
    // (p_sort_key/p_sort_dir), so the streamed batches stay stable as they arrive.
    // The tab/email/search filters above only narrow the set; they never reorder it.
    return result;
  }, [contacts, activeTab, emailOnly, searchQuery]);

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

  // Contacts in the current view that have a verified email still locked behind the +1 credit reveal.
  const lockedEmailContacts = useMemo(
    () => filteredContacts.filter((c) => c.has_email && c.email_unlocked === false),
    [filteredContacts]
  );

  // Patch revealed emails into local state (the RPC returns {contact_id, email}) so we never
  // refetch the whole event after a reveal.
  const applyRevealed = useCallback(
    (revealed: { contact_id: string; email: string | null }[], newBalance: number | null) => {
      const map = new Map(revealed.map((r) => [r.contact_id, r.email]));
      setContacts((prev) =>
        prev.map((c) =>
          map.has(c.contact_id)
            ? { ...c, email: map.get(c.contact_id) ?? c.email, email_unlocked: true }
            : c
        )
      );
      if (newBalance !== null) setCredits(newBalance);
      window.dispatchEvent(new CustomEvent("credits-updated"));
    },
    []
  );

  async function handleRevealEmail(contactId: string) {
    if (!selectedEventId) return;
    setRevealingIds((prev) => new Set(prev).add(contactId));
    setUnlockError(null);
    const { data, error } = await supabase.rpc("reveal_event_emails", {
      p_event_id: selectedEventId,
      p_contact_ids: [contactId],
    });
    setRevealingIds((prev) => {
      const next = new Set(prev);
      next.delete(contactId);
      return next;
    });
    if (error) return setUnlockError(error.message);
    if (!data?.success) return setUnlockError(data?.message ?? "Could not reveal email");
    applyRevealed(data.revealed ?? [], data.new_balance ?? null);
  }

  async function handleRevealAll(ids: string[]) {
    if (!selectedEventId || ids.length === 0) return;
    setRevealingAll(true);
    setUnlockError(null);
    setUnlockSuccess(null);
    const { data, error } = await supabase.rpc("reveal_event_emails", {
      p_event_id: selectedEventId,
      p_contact_ids: ids,
    });
    setRevealingAll(false);
    if (error) return setUnlockError(error.message);
    if (!data?.success) return setUnlockError(data?.message ?? "Could not reveal emails");
    applyRevealed(data.revealed ?? [], data.new_balance ?? null);
    setUnlockSuccess(
      `${data.emails_revealed} email${data.emails_revealed !== 1 ? "s" : ""} revealed! ${data.new_balance} credits remaining.`
    );
    setTimeout(() => setUnlockSuccess(null), 5000);
  }

  function handleContactsDownloaded(downloadedIds: string[]) {
    setContacts((prev) =>
      prev.map((c) =>
        downloadedIds.includes(c.contact_id)
          ? { ...c, is_downloaded: true, downloaded_at: new Date().toISOString() }
          : c
      )
    );
  }

  // Mark/unmark leads as processed. Optimistic: the toggle flips instantly and
  // reverts if the RPC fails.
  const setProcessedLocal = useCallback((ids: string[], processed: boolean) => {
    setContacts((prev) =>
      prev.map((c) =>
        ids.includes(c.contact_id)
          ? {
              ...c,
              is_downloaded: processed,
              downloaded_at: processed ? new Date().toISOString() : null,
            }
          : c
      )
    );
  }, []);

  async function handleSetProcessed(ids: string[], processed: boolean) {
    if (!selectedEventId || ids.length === 0) return;
    setTogglingProcessed((prev) => new Set([...prev, ...ids]));
    setProcessedLocal(ids, processed);
    const { data, error } = await supabase.rpc("set_contacts_processed", {
      p_event_id: selectedEventId,
      p_contact_ids: ids,
      p_processed: processed,
    });
    setTogglingProcessed((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    if (error || !data?.success) {
      setProcessedLocal(ids, !processed);
      setUnlockError(error?.message ?? data?.message ?? "Could not update lead status");
    }
  }

  function handleToggleProcessed(contactId: string, processed: boolean) {
    if (togglingProcessed.has(contactId)) return;
    if (!processed) {
      // Undoing "processed" loses the timestamp, so it asks first.
      setConfirmMarkNew([contactId]);
      return;
    }
    handleSetProcessed([contactId], processed);
  }

  async function handleSaveNote(contactId: string, note: string): Promise<boolean> {
    if (!selectedEventId) return false;
    const { data, error } = await supabase.rpc("set_contact_note", {
      p_event_id: selectedEventId,
      p_contact_id: contactId,
      p_note: note,
    });
    if (error || !data?.success) return false;
    const savedNote = (data.note as string | null) ?? null;
    setContacts((prev) =>
      prev.map((c) => (c.contact_id === contactId ? { ...c, lead_note: savedNote } : c))
    );
    return true;
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

  async function handleUnlockMore(opts?: { ignoreFilters?: boolean }) {
    if (!selectedEventId || !selectedEvent || credits === null) return;

    // "Unlock all (ignore filters)" sends no filters and targets the whole
    // remaining pool; otherwise we unlock the slider count among the matches.
    const useFilters = !opts?.ignoreFilters && icpActive;
    const payloadFilters = useFilters ? cleanIcp : {};
    const totalOwned = selectedEvent.new_contacts + selectedEvent.processed_contacts;
    const wholeRemaining = Math.max(0, selectedEvent.total_contacts - totalOwned);
    const target = opts?.ignoreFilters
      ? Math.min(credits, wholeRemaining)
      : unlockSliderValue;

    if (target <= 0) return;
    setUnlocking(true);
    setUnlockTarget(target);
    setUnlockProgress(0);
    setUnlockError(null);
    setUnlockSuccess(null);

    // Unlock in batches so each RPC call stays well under Postgres'
    // statement_timeout. A single large unlock does a heavy sort + bulk
    // insert that exceeds the 8s limit; chunking keeps every call fast.
    const UNLOCK_BATCH_SIZE = 1000;
    let remaining = target;
    let totalUnlocked = 0;
    let latestBalance = credits;
    let emailsIncluded = 0;
    // All chunks of this unlock share one unlock-history batch row.
    let historyBatchId: string | null = null;

    while (remaining > 0) {
      const batchCount = Math.min(UNLOCK_BATCH_SIZE, remaining);
      const { data, error: rpcError } = await supabase.rpc("unlock_event_contacts", {
        p_event_id: selectedEventId,
        p_count: batchCount,
        p_filters: payloadFilters,
        p_batch_id: historyBatchId,
      });

      if (rpcError) {
        setUnlockError(
          totalUnlocked > 0
            ? `${rpcError.message} (${totalUnlocked} contacts unlocked before this error — you can retry to continue.)`
            : rpcError.message
        );
        setUnlocking(false);
        return;
      }

      const result = data as UnlockResult;
      if (!result.success) {
        if (totalUnlocked > 0) break;
        setUnlockError(result.message);
        setUnlocking(false);
        return;
      }

      const justUnlocked = result.contacts_unlocked ?? 0;
      totalUnlocked += justUnlocked;
      latestBalance = result.new_balance ?? latestBalance;
      emailsIncluded += result.emails_included ?? 0;
      historyBatchId = result.batch_id ?? historyBatchId;
      remaining -= batchCount;
      setUnlockProgress(totalUnlocked);

      if (justUnlocked < batchCount) break;
    }

    setCredits(latestBalance);
    setUnlockSuccess(
      emailsIncluded > 0
        ? `${totalUnlocked} contacts unlocked with verified emails included (full list). ${latestBalance} credits remaining.`
        : `${totalUnlocked} contacts unlocked! ${latestBalance} credits remaining.`
    );
    window.dispatchEvent(new CustomEvent("credits-updated"));

    // Re-fetch contacts to include newly unlocked ones + refresh unlock history
    // and the filter bar's matched/owned counts.
    setFacetsRefreshKey((k) => k + 1);
    await Promise.all([fetchContacts(), fetchBatches()]);

    setShowUnlockPanel(false);
    setUnlocking(false);

    // Auto-clear success message after 5 seconds
    setTimeout(() => setUnlockSuccess(null), 5000);
  }

  if (subscribedEvents.length === 0 && loadError) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Unlocked Events
        </h1>
        <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <span>
            We couldn&apos;t load your unlocked events. This is usually
            temporary.
          </span>
          <button
            onClick={() => router.refresh()}
            className="cursor-pointer rounded-md border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-200 dark:hover:bg-zinc-800"
          >
            Retry
          </button>
        </div>
      </div>
    );
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
                  setShowUnlockPanel(false);
                  setUnlockSuccess(null);
                  setUnlockError(null);
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
                  ) : event.is_whogoes_active ? (
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
                  const pct = event.total_contacts > 0 ? Math.min(100, (unlocked / event.total_contacts) * 100) : 0;
                  const remaining = Math.max(0, event.total_contacts - unlocked);
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
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEventId(event.event_id);
                      setActiveTab("all");
                      setSearchQuery("");
                      setPage(0);
                      setSelectedIds(new Set());
                      setShowUnlockPanel(true);
                      setUnlockSuccess(null);
                      setUnlockError(null);
                    }}
                    className="mt-2 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-emerald-600 transition-colors hover:text-emerald-500 dark:text-emerald-400"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Unlock more contacts
                  </span>
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
          {selectedEvent.is_whogoes_active ? (
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

      {/* ICP filter bar — rendered OUTSIDE the loading/error gate so it stays mounted
          across refetches. It scopes the table below, the "unlock more" count and the
          bulk reveal. Inside the gate it would unmount on every filter-driven refetch,
          losing its selection and resetting the filter. */}
      {selectedEvent && (
        <div className="mt-6">
          <EventFilters
            eventId={selectedEventId}
            totalContacts={selectedEvent.total_contacts}
            externalFilters={externalFilters}
            externalKey={externalKey}
            refreshKey={facetsRefreshKey}
            onChange={(f, matched, _withEmail, owned) => {
              setIcpFilters(f);
              setMatchedCount(matched);
              setOwnedMatched(owned);
            }}
          />
        </div>
      )}

      {/* Unlock history: which filter produced each batch of owned contacts.
          Answers "what did I already unlock here?" and offers re-applying a
          batch's filters to unlock more of the same segment. */}
      {selectedEvent && unlockBatches.length > 0 && (
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            className="flex w-full cursor-pointer items-center justify-between text-left"
          >
            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Unlock history
              <span className="ml-2 font-normal text-zinc-400">
                {unlockBatches.length} unlock{unlockBatches.length !== 1 ? "s" : ""}
              </span>
            </span>
            <svg
              className={`h-4 w-4 text-zinc-400 transition-transform ${showHistory ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showHistory && (
            <div className="mt-3 space-y-2">
              {unlockBatches.map((b) => {
                const chips = describeFilters(b.filters as EventFiltersValue);
                return (
                  <div
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-100 px-3 py-2.5 dark:border-zinc-800"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs tabular-nums text-zinc-400">
                        {new Date(b.created_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {b.unlocked_count.toLocaleString()} contact{b.unlocked_count !== 1 ? "s" : ""}
                      </span>
                      {chips.length === 0 ? (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          No filters
                        </span>
                      ) : (
                        chips.map((c) => (
                          <span
                            key={c}
                            className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                          >
                            {c}
                          </span>
                        ))
                      )}
                    </div>
                    {chips.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setExternalFilters(b.filters as EventFiltersValue);
                          setExternalKey((k) => k + 1);
                        }}
                        className="cursor-pointer text-xs font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
                      >
                        Apply these filters
                      </button>
                    )}
                  </div>
                );
              })}

              {(() => {
                const tracked = unlockBatches.reduce((s, b) => s + b.unlocked_count, 0);
                const ownedTotal = selectedEvent.new_contacts + selectedEvent.processed_contacts;
                const earlier = Math.max(0, ownedTotal - tracked);
                return earlier > 0 ? (
                  <p className="px-1 text-xs text-zinc-400">
                    {earlier.toLocaleString()} more contact{earlier !== 1 ? "s" : ""} from unlocks
                    before history tracking or via the API.
                  </p>
                ) : null;
              })()}
            </div>
          )}
        </div>
      )}

      {loading && !initialLoadDone && (() => {
        // Initial load only. We load the user's unlocked contacts in pages of
        // 1,000. The total to load is the unlocked count (new + processed). Show
        // real progress so a high-volume event (e.g. several thousand contacts)
        // reads as moving, not stuck. Fall back to indeterminate until we know
        // the total. Re-fetches (filter changes) keep the table mounted with an
        // overlay instead of swapping in this full-height loader — see below.
        const expectedTotal = selectedEvent
          ? selectedEvent.new_contacts + selectedEvent.processed_contacts
          : 0;
        const hasTotal = expectedTotal > 0;
        const pct = hasTotal
          ? Math.min(100, Math.round((loadedCount / expectedTotal) * 100))
          : 0;
        return (
          <div className="mt-12 flex h-48 flex-col items-center justify-center gap-3">
            <div className="w-full max-w-sm">
              <div className="mb-2 flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400">
                <span>Loading contacts...</span>
                {hasTotal && (
                  <span className="tabular-nums">
                    {loadedCount.toLocaleString()} / {expectedTotal.toLocaleString()}
                  </span>
                )}
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className={`h-full rounded-full bg-emerald-600 transition-[width] duration-300 ease-out ${
                    hasTotal ? "" : "w-1/3 animate-pulse"
                  }`}
                  style={hasTotal ? { width: `${pct}%` } : undefined}
                />
              </div>
            </div>
          </div>
        );
      })()}

      {!loading && contactsError && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          <span>We couldn&apos;t load these contacts. This is usually temporary.</span>
          <button
            onClick={() => fetchContacts()}
            className="cursor-pointer rounded-md border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-zinc-900 dark:text-amber-200 dark:hover:bg-zinc-800"
          >
            Retry
          </button>
        </div>
      )}

      {!contactsError && (initialLoadDone || !loading) && (
        <>
          {/* Stats row */}
          {selectedEvent && (
            <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-zinc-500">
              {/* When a filter is active, the count reads as "your matching
                  contacts" (not "of the whole event"), so it no longer conflates
                  owned-matches with the much larger event-wide match total. */}
              {icpActive ? (
                <span>
                  <strong className="text-blue-600 dark:text-blue-400">
                    {contacts.length.toLocaleString()}
                  </strong>{" "}
                  of your unlocked contacts match
                </span>
              ) : (
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
              )}
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
              {remainingForEvent > 0 && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-600">·</span>
                  <button
                    onClick={() => {
                      setShowUnlockPanel(!showUnlockPanel);
                      setUnlockError(null);
                      const idx = unlockSliderSteps.findIndex((s) => s >= 20);
                      setSliderIndex(idx >= 0 ? idx : unlockSliderSteps.length - 1);
                    }}
                    className="inline-flex cursor-pointer items-center gap-1 font-medium text-emerald-600 transition-colors hover:text-emerald-500 dark:text-emerald-400"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    {icpActive
                      ? `${remainingForEvent.toLocaleString()} more match — unlock`
                      : "Unlock more"}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Unlock success toast */}
          {unlockSuccess && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {unlockSuccess}
              </div>
            </div>
          )}

          {/* Unlock More Panel */}
          {selectedEvent && contacts.length < selectedEvent.total_contacts && !unlockSuccess && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 px-5 py-4 dark:border-emerald-800/50 dark:bg-emerald-900/10">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                    {icpActive
                      ? `${remainingForEvent.toLocaleString()} more contacts match your filters`
                      : `${remainingForEvent.toLocaleString()} more contacts available`}
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-600/70 dark:text-emerald-400/60">
                    1 credit each for name, title, company, LinkedIn and post. Reveal emails for 1 more credit.
                  </p>
                </div>
                {!showUnlockPanel && (
                  <button
                    onClick={() => {
                      setShowUnlockPanel(true);
                      setUnlockError(null);
                      const idx = unlockSliderSteps.findIndex((s) => s >= 20);
                      setSliderIndex(idx >= 0 ? idx : unlockSliderSteps.length - 1);
                    }}
                    className="shrink-0 cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                  >
                    Unlock
                  </button>
                )}
              </div>

              {/* Expanded inline unlock controls */}
              {showUnlockPanel && credits !== null && credits > 0 && (
                <div className="mx-auto mt-4 max-w-lg">
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {icpActive ? "How many matching contacts to unlock?" : "How many contacts to unlock?"}
                  </label>
                  {maxUnlock > 0 ? (
                    <>
                      <div className="mt-2 flex items-center gap-4">
                        <span className="text-xs text-zinc-400">{unlockSliderSteps[0] ?? 1}</span>
                        <input
                          type="range"
                          min={0}
                          max={unlockSliderSteps.length - 1}
                          value={customUnlockCount !== null ? unlockSliderSteps.findLastIndex((s) => s <= unlockSliderValue) : sliderIndex}
                          onChange={(e) => {
                            setCustomUnlockCount(null);
                            setSliderIndex(Number(e.target.value));
                          }}
                          className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-200 accent-emerald-600 dark:bg-zinc-700"
                        />
                        <span className="text-xs text-zinc-400">{maxUnlock}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={maxUnlock}
                          value={unlockSliderValue}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            setCustomUnlockCount(Number.isNaN(v) ? 1 : v);
                          }}
                          className="w-24 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-center text-lg font-bold tabular-nums text-zinc-900 focus:border-emerald-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                          aria-label="Exact number of contacts to unlock"
                        />
                        <span className="text-sm text-zinc-500">
                          {icpActive
                            ? `match${unlockSliderValue !== 1 ? "es" : ""}`
                            : `contact${unlockSliderValue !== 1 ? "s" : ""}`}
                        </span>
                      </div>
                    </>
                  ) : (
                    <p className="mt-2 text-center text-sm text-zinc-500">
                      You already own every contact that matches these filters. Use the option below to unlock the rest of the event.
                    </p>
                  )}

                  {/* Cost breakdown */}
                  <div className="mt-3 rounded-xl bg-white p-3 ring-1 ring-zinc-200 dark:bg-zinc-800/50 dark:ring-zinc-700">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Cost</span>
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {unlockSliderValue} credit{unlockSliderValue !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Your balance</span>
                      <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                        {credits} credit{credits !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between border-t border-zinc-100 pt-1 text-sm dark:border-zinc-700">
                      <span className="text-zinc-500">After unlock</span>
                      <span className={`font-semibold ${
                        credits - unlockSliderValue <= 5
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }`}>
                        {credits - unlockSliderValue} remaining
                      </span>
                    </div>
                    {fullListSelected ? (
                      <div className="mt-1 flex items-center justify-between border-t border-zinc-100 pt-1 text-xs dark:border-zinc-700">
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">Verified emails</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">Included (full list)</span>
                      </div>
                    ) : (
                      <div className="mt-1 flex items-center justify-between border-t border-zinc-100 pt-1 text-xs dark:border-zinc-700">
                        <span className="text-zinc-400">Email reveal (optional, later)</span>
                        <span className="text-zinc-500">+1 credit per contact</span>
                      </div>
                    )}
                  </div>

                  {/* Nudge toward the full-list deal when it is affordable */}
                  {!icpActive && !fullListSelected && remainingWholeEvent > 0 && remainingWholeEvent <= (credits ?? 0) && (
                    <button
                      onClick={() => setCustomUnlockCount(remainingWholeEvent)}
                      className="mt-2 w-full cursor-pointer rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-center text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                    >
                      Take the whole list ({remainingWholeEvent.toLocaleString()} contacts) and every verified email is included free
                    </button>
                  )}

                  {/* Action buttons — the unlock opens a confirmation with the exact
                      terms (event, filters, cost) before any credits are spent */}
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setConfirmUnlock({})}
                      disabled={unlocking || unlockSliderValue <= 0}
                      className="flex-1 cursor-pointer rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {unlocking
                        ? unlockProgress > 0
                          ? `Unlocking... ${unlockProgress.toLocaleString()} / ${unlockTarget.toLocaleString()}`
                          : "Unlocking..."
                        : icpActive
                          ? `Unlock ${unlockSliderValue} Match${unlockSliderValue !== 1 ? "es" : ""}`
                          : `Unlock ${unlockSliderValue} Contact${unlockSliderValue !== 1 ? "s" : ""}`}
                    </button>
                    <button
                      onClick={() => setShowUnlockPanel(false)}
                      className="cursor-pointer rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>

                  {/* When filtering, let power users bypass the filter and grab the whole remaining pool. */}
                  {icpActive && (
                    <button
                      onClick={() => setConfirmUnlock({ ignoreFilters: true })}
                      disabled={unlocking}
                      className="mt-2 w-full cursor-pointer text-center text-xs font-medium text-zinc-500 underline-offset-2 transition-colors hover:text-zinc-700 hover:underline disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200"
                    >
                      Unlock all remaining (ignore filters)
                      {(credits ?? 0) >= remainingWholeEvent && remainingWholeEvent > 0
                        ? ", verified emails included"
                        : ""}
                    </button>
                  )}

                  {unlockError && (
                    <p className="mt-2 text-center text-sm text-red-600 dark:text-red-400">{unlockError}</p>
                  )}
                </div>
              )}

              {/* No credits state */}
              {showUnlockPanel && credits !== null && credits <= 0 && (
                <div className="mt-4 text-center">
                  <p className="text-sm text-zinc-500">You have no credits remaining.</p>
                  <button
                    onClick={() => window.dispatchEvent(new CustomEvent("open-buy-credits"))}
                    className="mt-2 cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                  >
                    Get More Credits
                  </button>
                </div>
              )}

              {/* Credits still loading */}
              {showUnlockPanel && credits === null && (
                <p className="mt-4 text-center text-sm text-zinc-400">Loading...</p>
              )}
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

            {lockedEmailContacts.length > 0 && (
              <button
                onClick={() => setConfirmReveal(lockedEmailContacts.map((c) => c.contact_id))}
                disabled={revealingAll}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                title="Reveal the verified emails for every contact shown, 1 credit each"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                {revealingAll
                  ? "Revealing emails..."
                  : `Reveal ${lockedEmailContacts.length.toLocaleString()} email${lockedEmailContacts.length !== 1 ? "s" : ""} · ${lockedEmailContacts.length.toLocaleString()} cr`}
              </button>
            )}

            {/* Bulk processed toggle for the selected rows: marks the unprocessed ones
                done, or (when all are already processed) flips them back to new. */}
            {selectedContacts.length > 0 && (() => {
              const unprocessedSelected = selectedContacts.filter((c) => !c.is_downloaded);
              const markAsProcessed = unprocessedSelected.length > 0;
              const targets = markAsProcessed ? unprocessedSelected : selectedContacts;
              return (
                <button
                  onClick={() => {
                    const ids = targets.map((c) => c.contact_id);
                    if (markAsProcessed) {
                      handleSetProcessed(ids, true);
                    } else {
                      setConfirmMarkNew(ids);
                    }
                  }}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <svg className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {markAsProcessed
                    ? `Mark ${targets.length.toLocaleString()} as processed`
                    : `Mark ${targets.length.toLocaleString()} as new`}
                </button>
              );
            })()}

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

          {/* Table — stays mounted while a filter-driven re-fetch runs; a subtle
              overlay signals "updating" so the screen never blanks or appears
              frozen between the old and new result sets. */}
          <div className="relative mt-4">
            {/* Filter-driven reload: keep the old rows visible under an overlay until the
                first batch of the new result swaps in (no blank flash). */}
            {refetching && (
              <div className="absolute inset-0 z-10 flex items-start justify-center rounded-xl bg-white/55 pt-20 backdrop-blur-[1px] dark:bg-zinc-950/55">
                <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Updating results…
                </span>
              </div>
            )}
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
              onRevealEmail={(contactId) => setConfirmReveal([contactId])}
              revealingIds={revealingIds}
              onToggleProcessed={handleToggleProcessed}
              onSaveNote={handleSaveNote}
            />
          </div>

          {/* Background streaming indicator: the first page is already interactive while
              the rest of the contacts load. Non-blocking, unlike the initial loader. */}
          {loading && initialLoadDone && !refetching && (
            <div className="mt-3 flex items-center gap-2 text-sm text-zinc-400">
              <svg className="h-4 w-4 animate-spin text-emerald-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="tabular-nums">
                Loading more contacts… {loadedCount.toLocaleString()}
                {selectedEvent && !icpActive
                  ? ` of ${(selectedEvent.new_contacts + selectedEvent.processed_contacts).toLocaleString()}`
                  : ""}{" "}
                loaded
              </span>
            </div>
          )}

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

      {/* Unlock confirmation — restates event, filters, cost and email terms before
          spending credits, so a stray click can never buy contacts by mistake. */}
      {confirmUnlock !== null && selectedEvent && credits !== null && (() => {
        const usesFilters = !confirmUnlock.ignoreFilters && icpActive;
        const confirmCount = confirmUnlock.ignoreFilters
          ? Math.min(credits, remainingWholeEvent)
          : unlockSliderValue;
        return (
          <UnlockConfirmModal
            eventName={
              selectedEvent.event_name.includes(String(selectedEvent.event_year))
                ? selectedEvent.event_name
                : `${selectedEvent.event_name} ${selectedEvent.event_year}`
            }
            count={confirmCount}
            filters={usesFilters ? cleanIcp : {}}
            credits={credits}
            emailsIncluded={
              !usesFilters && remainingWholeEvent > 0 && confirmCount >= remainingWholeEvent
            }
            onConfirm={() => {
              const opts = confirmUnlock;
              setConfirmUnlock(null);
              handleUnlockMore(opts);
            }}
            onCancel={() => setConfirmUnlock(null)}
          />
        );
      })()}

      {/* Un-marking processed loses the processed date, so it confirms first
          (marking processed stays one click since undoing it is right here). */}
      {confirmMarkNew !== null && (
        <ConfirmDialog
          title="Mark as new again?"
          body={`This clears the processed date on ${confirmMarkNew.length.toLocaleString()} lead${confirmMarkNew.length !== 1 ? "s" : ""}. You can mark ${confirmMarkNew.length !== 1 ? "them" : "it"} processed again anytime.`}
          confirmLabel={`Mark ${confirmMarkNew.length.toLocaleString()} as new`}
          onConfirm={() => {
            const ids = confirmMarkNew;
            setConfirmMarkNew(null);
            handleSetProcessed(ids, false);
          }}
          onCancel={() => setConfirmMarkNew(null)}
        />
      )}

      {/* Email reveals spend credits, so single and bulk both restate the count
          and cost before anything is charged. */}
      {confirmReveal !== null && (
        <ConfirmDialog
          title="Confirm email reveal"
          body="Verified emails cost 1 credit each to reveal. Credits are spent immediately."
          rows={[
            {
              label: "Emails to reveal",
              value: confirmReveal.length.toLocaleString(),
            },
            {
              label: "Cost",
              value: `${confirmReveal.length.toLocaleString()} credit${confirmReveal.length !== 1 ? "s" : ""}`,
            },
            {
              label: "Balance after",
              value: `${((credits ?? 0) - confirmReveal.length).toLocaleString()} credit${(credits ?? 0) - confirmReveal.length !== 1 ? "s" : ""}`,
              warn: (credits ?? 0) - confirmReveal.length <= 5,
            },
          ]}
          confirmLabel={`Reveal ${confirmReveal.length.toLocaleString()} email${confirmReveal.length !== 1 ? "s" : ""}`}
          onConfirm={() => {
            const ids = confirmReveal;
            setConfirmReveal(null);
            if (ids.length === 1) {
              handleRevealEmail(ids[0]);
            } else {
              handleRevealAll(ids);
            }
          }}
          onCancel={() => setConfirmReveal(null)}
        />
      )}
    </div>
  );
}
