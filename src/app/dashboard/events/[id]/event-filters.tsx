"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";

// Filter shape mirrors the jsonb contract of get_event_filter_facets /
// unlock_event_contacts. Empty arrays / strings / false are dropped before
// sending so an absent key means "no constraint on that axis".
export interface EventFiltersValue {
  seniority?: string[];
  function?: string[];
  industry?: string[];
  size?: string[];
  country?: string[];
  role?: string[];
  speaker?: boolean;
  title_keyword?: string;
  company_include?: string;
  company_exclude?: string;
}

interface FacetItem {
  key: string;
  count: number;
}
export interface Facets {
  matched: number;
  with_email: number;
  by_seniority: FacetItem[];
  by_function: FacetItem[];
  by_role: FacetItem[];
  by_industry: FacetItem[];
  by_size: FacetItem[];
  by_country: FacetItem[];
  top_companies: FacetItem[];
}

// Pretty labels. IC is shown spelled out per the product decision.
const SENIORITY_LABELS: Record<string, string> = {
  IC: "Individual Contributor (Staff)",
};
const ROLE_LABELS: Record<string, string> = {
  organizer: "Organizer",
  sponsor: "Sponsor",
  exhibitor: "Exhibitor",
  attendee: "Attendee (confirmed)",
  // Reposted the event (no first-person post) — attendance not confirmed. Mentions and
  // first-person posts count as confirmed Attendee.
  expected_attendee: "Expected attendee",
};
const label = (map: Record<string, string>, k: string) => map[k] ?? k;

// Thin indeterminate progress bar shown while filtered results recompute (the live
// filter queries take a couple seconds on large events). Gives immediate feedback so the
// UI never looks frozen on the previous result.
function LoadingBar() {
  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-900/30">
      <span className="animate-indeterminate-bar bg-emerald-500 dark:bg-emerald-400" />
    </div>
  );
}

// Strip empties so the jsonb only carries real constraints.
export function cleanFilters(f: EventFiltersValue): EventFiltersValue {
  const out: EventFiltersValue = {};
  if (f.seniority?.length) out.seniority = f.seniority;
  if (f.function?.length) out.function = f.function;
  if (f.industry?.length) out.industry = f.industry;
  if (f.size?.length) out.size = f.size;
  if (f.country?.length) out.country = f.country;
  if (f.role?.length) out.role = f.role;
  if (f.speaker) out.speaker = true;
  if (f.title_keyword?.trim()) out.title_keyword = f.title_keyword.trim();
  if (f.company_include?.trim()) out.company_include = f.company_include.trim();
  if (f.company_exclude?.trim()) out.company_exclude = f.company_exclude.trim();
  return out;
}

export function isFilterActive(f: EventFiltersValue): boolean {
  return Object.keys(cleanFilters(f)).length > 0;
}

function MultiSelect({
  title,
  options,
  selected,
  onToggle,
  labelMap,
}: {
  title: string;
  options: FacetItem[];
  selected: string[];
  onToggle: (key: string) => void;
  labelMap?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  if (options.length === 0) return null;
  const count = selected.length;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
          count > 0
            ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
            : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        }`}
      >
        {title}
        {count > 0 && (
          <span className="rounded-full bg-emerald-600 px-1.5 text-xs font-semibold text-white">
            {count}
          </span>
        )}
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {options.map((o) => {
            const isSel = selected.includes(o.key);
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => onToggle(o.key)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                      isSel
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-zinc-300 dark:border-zinc-600"
                    }`}
                  >
                    {isSel && (
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {labelMap ? label(labelMap, o.key) : o.key}
                  </span>
                </span>
                <span className="tabular-nums text-xs text-zinc-400">{o.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function EventFilters({
  eventId,
  totalContacts,
  onChange,
  defaultBreakdownOpen = false,
  initialFacets = null,
}: {
  eventId: string;
  totalContacts: number;
  onChange: (filters: EventFiltersValue, matched: number | null, withEmail: number | null) => void;
  // Pre-unlock event page opens the composition breakdown by default (trust signal);
  // My Events leaves it collapsed since the table itself is the source of truth.
  defaultBreakdownOpen?: boolean;
  // Server-cached unfiltered facets (events.facets_cache). When present the breakdown
  // renders instantly with no RPC on mount; the live RPC only runs once a filter is
  // applied. Absent (e.g. admin/My Events) falls back to fetching on mount.
  initialFacets?: Facets | null;
}) {
  const supabase = createClient();
  const [filters, setFilters] = useState<EventFiltersValue>({});
  const [base, setBase] = useState<Facets | null>(initialFacets); // unfiltered: option universe
  const [live, setLive] = useState<Facets | null>(initialFacets); // current matched counts
  const [loading, setLoading] = useState(!initialFacets);
  // True from the instant a filter changes until the live counts come back, so the summary
  // and breakdown show a loading state instead of stale numbers.
  const [recounting, setRecounting] = useState(false);
  const [facetError, setFacetError] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(defaultBreakdownOpen);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Option universe (counts across the whole event). Seeded from the server cache when
  // available; otherwise fetched once (the slow live path, kept for non-cached callers).
  useEffect(() => {
    if (initialFacets) {
      onChange({}, initialFacets.matched, initialFacets.with_email);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_event_filter_facets", {
        p_event_id: eventId,
        p_filters: {},
      });
      if (cancelled) return;
      if (error || !data) {
        setFacetError(true);
        setLoading(false);
        return;
      }
      setBase(data as Facets);
      setLive(data as Facets);
      setLoading(false);
      onChange({}, (data as Facets).matched, (data as Facets).with_email);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  // Refetch live counts on filter change (debounced). Empty filters reuse base.
  useEffect(() => {
    if (!base) return;
    const cleaned = cleanFilters(filters);
    if (Object.keys(cleaned).length === 0) {
      setRecounting(false);
      setLive(base);
      onChange({}, base.matched, base.with_email);
      return;
    }
    // Show the loading state immediately (before the debounce + the ~couple-second query)
    // so the breakdown never appears stuck on the previous filter's numbers.
    setRecounting(true);
    // Tell the parent the filter is active right away (matched = null = "still counting")
    // so the filtered preview mounts and shows its loading bar instantly, instead of the
    // page sitting on the unfiltered table until the query returns.
    onChange(cleaned, null, null);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const { data, error } = await supabase.rpc("get_event_filter_facets", {
        p_event_id: eventId,
        p_filters: cleaned,
      });
      if (error || !data) {
        setRecounting(false);
        return;
      }
      setLive(data as Facets);
      onChange(cleaned, (data as Facets).matched, (data as Facets).with_email);
      setRecounting(false);
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, base]);

  const toggle = useCallback((axis: keyof EventFiltersValue, key: string) => {
    setFilters((f) => {
      const cur = (f[axis] as string[] | undefined) ?? [];
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      return { ...f, [axis]: next };
    });
  }, []);

  const setText = useCallback((axis: keyof EventFiltersValue, val: string) => {
    setFilters((f) => ({ ...f, [axis]: val }));
  }, []);

  // Size buckets in natural order, using the per-event counts from base facets.
  const sizeOptions: FacetItem[] = useMemo(() => {
    const order = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+"];
    const counts = new Map((base?.by_size ?? []).map((i) => [i.key, i.count]));
    return order.filter((k) => counts.has(k)).map((k) => ({ key: k, count: counts.get(k) ?? 0 }));
  }, [base]);

  const active = isFilterActive(filters);
  const matched = live?.matched ?? null;

  const chips: { axis: keyof EventFiltersValue; key: string; text: string }[] = [];
  (["seniority", "function", "role", "industry", "size", "country"] as const).forEach((axis: keyof EventFiltersValue) => {
    ((filters[axis] as string[] | undefined) ?? []).forEach((key) => {
      const text =
        axis === "role" ? label(ROLE_LABELS, key) : axis === "seniority" ? label(SENIORITY_LABELS, key) : key;
      chips.push({ axis, key, text });
    });
  });

  if (facetError) return null; // fail quietly: page still works without filters

  return (
    <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Filter:</span>
        <MultiSelect title="Seniority" options={base?.by_seniority ?? []} selected={filters.seniority ?? []} onToggle={(k) => toggle("seniority", k)} labelMap={SENIORITY_LABELS} />
        <MultiSelect title="Function" options={base?.by_function ?? []} selected={filters.function ?? []} onToggle={(k) => toggle("function", k)} />
        <MultiSelect title="Industry" options={base?.by_industry ?? []} selected={filters.industry ?? []} onToggle={(k) => toggle("industry", k)} />
        <MultiSelect title="Event role" options={base?.by_role ?? []} selected={filters.role ?? []} onToggle={(k) => toggle("role", k)} labelMap={ROLE_LABELS} />
        <MultiSelect title="Company size" options={sizeOptions} selected={filters.size ?? []} onToggle={(k) => toggle("size", k)} />
        <MultiSelect title="Country" options={base?.by_country ?? []} selected={filters.country ?? []} onToggle={(k) => toggle("country", k)} />
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
          <input
            type="checkbox"
            checked={filters.speaker ?? false}
            onChange={(e) => setFilters((f) => ({ ...f, speaker: e.target.checked }))}
            className="h-3.5 w-3.5 accent-emerald-600"
          />
          Speakers only
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Job-title keyword"
          value={filters.title_keyword ?? ""}
          onChange={(e) => setText("title_keyword", e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 placeholder:text-zinc-400 focus:border-emerald-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        />
        <input
          type="text"
          placeholder="Company contains"
          value={filters.company_include ?? ""}
          onChange={(e) => setText("company_include", e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 placeholder:text-zinc-400 focus:border-emerald-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        />
        <input
          type="text"
          placeholder="Company excludes"
          value={filters.company_exclude ?? ""}
          onChange={(e) => setText("company_exclude", e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 placeholder:text-zinc-400 focus:border-emerald-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        />
      </div>

      {/* Active filter chips */}
      {(chips.length > 0 || filters.speaker || filters.title_keyword || filters.company_include || filters.company_exclude) && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={`${c.axis}-${c.key}`}
              type="button"
              onClick={() => toggle(c.axis, c.key)}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300"
            >
              {c.text}
              <span className="text-emerald-400">&times;</span>
            </button>
          ))}
          {filters.speaker && (
            <button type="button" onClick={() => setFilters((f) => ({ ...f, speaker: false }))} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300">Speakers <span className="text-emerald-400">&times;</span></button>
          )}
          <button
            type="button"
            onClick={() => setFilters({})}
            className="ml-1 text-xs font-medium text-zinc-400 underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Live match summary */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {loading || recounting ? (
            <span className="inline-flex items-center gap-2">
              <svg className="h-3.5 w-3.5 animate-spin text-emerald-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Counting matches...
            </span>
          ) : active && matched !== null ? (
            <>
              <strong className="text-zinc-900 dark:text-zinc-100">{matched.toLocaleString()}</strong> of{" "}
              {totalContacts.toLocaleString()} contacts match
              {live && (
                <span className="text-zinc-400">
                  {" "}({live.with_email.toLocaleString()} with email)
                </span>
              )}
            </>
          ) : (
            <>
              <strong className="text-zinc-900 dark:text-zinc-100">{totalContacts.toLocaleString()}</strong> contacts
              {live && <span className="text-zinc-400"> ({live.with_email.toLocaleString()} with email)</span>}
            </>
          )}
        </p>
        {live && (
          <button
            type="button"
            onClick={() => setShowBreakdown((s) => !s)}
            className="text-xs font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
          >
            {showBreakdown ? "Hide breakdown" : "Show breakdown"}
          </button>
        )}
      </div>

      {/* Breakdown strip (proof surface) */}
      {showBreakdown && live && (
        <div className="mt-3">
          {recounting && (
            <div className="mb-3">
              <LoadingBar />
            </div>
          )}
          <div
            className={`grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-4 ${
              recounting ? "opacity-40" : "opacity-100"
            }`}
          >
            <BreakdownCol title="By role" items={live.by_role} labelMap={ROLE_LABELS} />
            <BreakdownCol title="By seniority" items={live.by_seniority} labelMap={SENIORITY_LABELS} />
            <BreakdownCol title="By industry" items={live.by_industry} />
            <BreakdownCol title="Top companies" items={live.top_companies} />
          </div>
        </div>
      )}
    </div>
  );
}

// --- Filtered preview (the tease): one fully-named sample row + redacted ICP rows ---

interface PreviewSample {
  full_name: string | null;
  current_title: string | null;
  company_name: string | null;
  company_industry: string | null;
  company_size: string | null;
  country: string | null;
  seniority: string | null;
  function: string | null;
  role: string;
  is_speaker: boolean;
  has_email: boolean;
  contact_linkedin_url: string | null;
  post_url: string | null;
}
interface PreviewRow {
  seniority: string | null;
  function: string | null;
  industry: string | null;
  size: string | null;
  country: string | null;
  role: string;
  is_speaker: boolean;
  has_email: boolean;
}
interface PreviewData {
  matched: number;
  with_email: number;
  sample: PreviewSample | null;
  rows: PreviewRow[];
}

function Blur({ w }: { w: string }) {
  return <div className={`h-4 ${w} rounded bg-zinc-200 blur-[5px] dark:bg-zinc-700`} />;
}

// Shimmer placeholder row shown while a filtered query is in flight. Reads as "loading"
// (pulse, not blur) so it isn't confused with the redacted/locked rows.
const SKELETON_WIDTHS = ["w-28", "w-20", "w-16", "w-24", "w-20", "w-12", "w-16", "w-20", "w-10", "w-10"];
function SkeletonRow() {
  return (
    <tr>
      {SKELETON_WIDTHS.map((w, i) => (
        <td key={i} className="px-3 py-3">
          <div className={`h-4 ${w} animate-pulse rounded bg-zinc-200 dark:bg-zinc-700`} />
        </td>
      ))}
    </tr>
  );
}

export function FilteredPreview({
  eventId,
  filters,
  active,
}: {
  eventId: string;
  filters: EventFiltersValue;
  active: boolean;
}) {
  const supabase = createClient();
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) {
      setData(null);
      return;
    }
    setLoading(true);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const { data: d, error } = await supabase.rpc("get_event_filter_preview", {
        p_event_id: eventId,
        p_filters: filters,
        p_limit: 8,
      });
      if (!error && d) setData(d as PreviewData);
      setLoading(false);
    }, 350);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, JSON.stringify(filters), active]);

  if (!active) return null;

  // While a query is in flight, show the loading state (bar + skeleton) instead of the
  // previous filter's rows, so the table never looks frozen on stale results.
  const noMatches = !loading && !!data && data.matched === 0;

  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-100 px-4 py-2.5 text-xs font-medium text-zinc-500 dark:border-zinc-800">
        {loading
          ? "Finding your matches..."
          : "Preview of your filtered matches. Names, companies and emails unlock when you spend credits."}
      </div>
      {loading && (
        <div className="px-4 pt-3">
          <LoadingBar />
        </div>
      )}
      <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
            {["Name", "Seniority", "Function", "Company", "Industry", "Size", "Country", "Role", "Post", "Email"].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
          {loading &&
            [0, 1, 2, 3, 4, 5].map((i) => <SkeletonRow key={`sk-${i}`} />)}
          {noMatches && (
            <tr><td colSpan={10} className="px-3 py-8 text-center text-sm text-zinc-400">No contacts match these filters. Try removing one.</td></tr>
          )}
          {!loading && data?.sample && (
            <tr className="bg-emerald-50/40 dark:bg-emerald-900/10">
              <td className="whitespace-nowrap px-3 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                {data.sample.full_name ?? "—"}
                <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">SAMPLE</span>
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-600 dark:text-zinc-400">{label(SENIORITY_LABELS, data.sample.seniority ?? "—")}</td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-600 dark:text-zinc-400">{data.sample.function ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-600 dark:text-zinc-400">{data.sample.company_name ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{data.sample.company_industry ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{data.sample.company_size ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{data.sample.country ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{label(ROLE_LABELS, data.sample.role)}</td>
              <td className="whitespace-nowrap px-3 py-3">
                {data.sample.post_url ? (
                  <a href={data.sample.post_url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400">View Post</a>
                ) : "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-400">{data.sample.has_email ? "Locked" : "—"}</td>
            </tr>
          )}
          {!loading && data?.rows.map((r, i) => (
            <tr key={i} className="select-none">
              <td className="px-3 py-3"><Blur w="w-24" /></td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-600 dark:text-zinc-400">{label(SENIORITY_LABELS, r.seniority ?? "—")}</td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-600 dark:text-zinc-400">{r.function ?? "—"}</td>
              <td className="px-3 py-3"><Blur w="w-20" /></td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{r.industry ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{r.size ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-500">{r.country ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
                {label(ROLE_LABELS, r.role)}
                {r.is_speaker && <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">Speaker</span>}
              </td>
              <td className="px-3 py-3"><Blur w="w-12" /></td>
              <td className="whitespace-nowrap px-3 py-3 text-zinc-400">{r.has_email ? "Locked" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function BreakdownCol({ title, items, labelMap }: { title: string; items: FacetItem[]; labelMap?: Record<string, string> }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</p>
      <div className="space-y-1">
        {items.slice(0, 8).map((it) => (
          <div key={it.key} className="flex items-center justify-between text-sm">
            <span className="truncate text-zinc-600 dark:text-zinc-400">{labelMap ? label(labelMap, it.key) : it.key}</span>
            <span className="ml-2 tabular-nums text-zinc-500">{it.count.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
