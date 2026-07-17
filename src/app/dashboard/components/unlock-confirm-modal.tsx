"use client";

import {
  describeFilters,
  type EventFiltersValue,
} from "@/app/dashboard/events/[id]/event-filters";

// Final check before credits are spent. Unlocking is irreversible, so every unlock
// path (slider, ignore-filters escape hatch, both surfaces) funnels through this
// modal: it restates the event, the exact filters, the cost and the email terms,
// then hands off to the caller's unlock function.
export default function UnlockConfirmModal({
  eventName,
  count,
  filters,
  credits,
  emailsIncluded,
  onConfirm,
  onCancel,
}: {
  eventName: string;
  count: number;
  filters: EventFiltersValue;
  credits: number;
  emailsIncluded: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const chips = describeFilters(filters);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm unlock"
      >
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Confirm unlock
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Credits are spent immediately and unlocks can&apos;t be undone.
        </p>

        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-zinc-500">Event</dt>
            <dd className="text-right font-medium text-zinc-900 dark:text-zinc-100">
              {eventName}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-zinc-500">Contacts</dt>
            <dd className="font-medium text-zinc-900 dark:text-zinc-100">
              {count.toLocaleString()}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-zinc-500">Filters</dt>
            <dd className="flex flex-wrap justify-end gap-1.5">
              {chips.length === 0 ? (
                <span className="text-zinc-700 dark:text-zinc-300">
                  None (best contacts first)
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
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            <dt className="shrink-0 text-zinc-500">Cost</dt>
            <dd className="font-semibold text-zinc-900 dark:text-zinc-100">
              {count.toLocaleString()} credit{count !== 1 ? "s" : ""}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-zinc-500">Balance after</dt>
            <dd
              className={`font-semibold ${
                credits - count <= 5
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-zinc-900 dark:text-zinc-100"
              }`}
            >
              {(credits - count).toLocaleString()} credit{credits - count !== 1 ? "s" : ""}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-zinc-500">Verified emails</dt>
            {emailsIncluded ? (
              <dd className="font-semibold text-emerald-600 dark:text-emerald-400">
                Included
              </dd>
            ) : (
              <dd className="text-zinc-500">+1 credit each, revealed later</dd>
            )}
          </div>
        </dl>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 cursor-pointer rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            Unlock {count.toLocaleString()} contact{count !== 1 ? "s" : ""}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
