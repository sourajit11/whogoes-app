"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { BrowsableEvent, ContactPreview, SubscribeResult } from "@/types";

interface EventPreviewModalProps {
  event: BrowsableEvent;
  credits: number;
  onClose: () => void;
}

export default function EventPreviewModal({
  event,
  credits,
  onClose,
}: EventPreviewModalProps) {
  const [previews, setPreviews] = useState<ContactPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const canAfford = credits >= event.total_contacts;

  useEffect(() => {
    async function fetchPreview() {
      const { data } = await supabase.rpc("get_event_preview", {
        p_event_id: event.event_id,
      });
      setPreviews(data ?? []);
      setLoading(false);
    }
    fetchPreview();
  }, [event.event_id, supabase]);

  async function handleSubscribe() {
    setSubscribing(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc(
      "subscribe_to_event",
      { p_event_id: event.event_id }
    );

    if (rpcError) {
      setError(rpcError.message);
      setSubscribing(false);
      return;
    }

    const result = data as SubscribeResult;
    if (!result.success) {
      setError(result.message);
      setSubscribing(false);
      return;
    }

    setSuccess(true);
    setTimeout(() => {
      router.refresh();
      onClose();
    }, 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-2xl rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-100 p-6 dark:border-zinc-800">
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {event.event_name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-400">
              {event.event_location && <span>{event.event_location}</span>}
              {event.event_start_date && (
                <>
                  <span>·</span>
                  <span>
                    {new Date(event.event_start_date).toLocaleDateString(
                      "en-US",
                      { month: "short", day: "numeric", year: "numeric" }
                    )}
                  </span>
                </>
              )}
              <span>·</span>
              {event.is_active ? (
                <span className="inline-flex items-center gap-1 text-emerald-500">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  Actively tracking
                </span>
              ) : (
                <span className="text-zinc-400">Data collection complete</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Cost info */}
        <div className="border-b border-zinc-100 bg-zinc-50/50 px-6 py-3 dark:border-zinc-800 dark:bg-zinc-800/30">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-zinc-500">
              <strong className="text-zinc-900 dark:text-zinc-100">
                {event.total_contacts.toLocaleString()}
              </strong>{" "}
              contacts
            </span>
            <span className="text-zinc-300 dark:text-zinc-600">·</span>
            <span className="text-zinc-500">
              Costs{" "}
              <strong className="text-zinc-900 dark:text-zinc-100">
                {event.total_contacts.toLocaleString()}
              </strong>{" "}
              credits
            </span>
            <span className="text-zinc-300 dark:text-zinc-600">·</span>
            <span className="text-zinc-500">
              Your balance:{" "}
              <strong
                className={
                  canAfford
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }
              >
                {credits.toLocaleString()}
              </strong>
            </span>
          </div>
        </div>

        {/* Preview table */}
        <div className="p-6">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-400">
            Preview ({loading ? "..." : `5 of ${event.total_contacts.toLocaleString()}`})
          </p>

          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-zinc-400">
              Loading preview...
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-zinc-500">
                      Name
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-zinc-500">
                      Title
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-zinc-500">
                      Company
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold uppercase text-zinc-500">
                      Location
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                  {previews.map((c) => (
                    <tr key={c.contact_id}>
                      <td className="whitespace-nowrap px-3 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                        {c.full_name ?? "—"}
                      </td>
                      <td className="max-w-40 truncate px-3 py-2.5 text-zinc-500">
                        {c.current_title ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-zinc-500">
                        {c.company_name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-zinc-400">
                        {[c.city, c.country].filter(Boolean).join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                  {/* Blurred placeholder rows */}
                  {[1, 2, 3].map((i) => (
                    <tr key={`blur-${i}`} className="select-none">
                      <td className="px-3 py-2.5">
                        <div className="h-4 w-24 rounded bg-zinc-200 blur-[4px] dark:bg-zinc-700" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="h-4 w-32 rounded bg-zinc-200 blur-[4px] dark:bg-zinc-700" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="h-4 w-20 rounded bg-zinc-200 blur-[4px] dark:bg-zinc-700" />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="h-4 w-16 rounded bg-zinc-200 blur-[4px] dark:bg-zinc-700" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-100 px-6 py-4 dark:border-zinc-800">
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
          {success && (
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              Subscribed successfully!
            </p>
          )}
          {!error && !success && <div />}

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSubscribe}
              disabled={!canAfford || subscribing || success}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {subscribing
                ? "Subscribing..."
                : success
                  ? "Done!"
                  : `Subscribe — ${event.total_contacts.toLocaleString()} credits`}
            </button>
          </div>
        </div>

        {!canAfford && !error && !success && (
          <div className="border-t border-zinc-100 px-6 py-3 dark:border-zinc-800">
            <p className="text-center text-xs text-amber-600 dark:text-amber-400">
              Insufficient credits. You need{" "}
              {(event.total_contacts - credits).toLocaleString()} more credits.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
