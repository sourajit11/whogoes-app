"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import BuyCreditsModal from "@/app/dashboard/components/buy-credits-modal";
import type {
  BrowsableEvent,
  ContactPreview,
  UnlockResult,
  EventUnlockStatus,
} from "@/types";

interface EventDetailProps {
  event: BrowsableEvent;
  credits: number;
  isAuthenticated: boolean;
  unlockStatus: EventUnlockStatus | null;
  userEmail?: string;
}

const FREE_PREVIEW_COUNT = 5;

function formatPostDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const date = new Date(dateStr);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

export default function EventDetail({
  event,
  credits: initialCredits,
  isAuthenticated,
  unlockStatus: initialUnlockStatus,
  userEmail,
}: EventDetailProps) {
  const [previews, setPreviews] = useState<ContactPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [credits, setCredits] = useState(initialCredits);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const [unlockStatus, setUnlockStatus] = useState<EventUnlockStatus | null>(
    initialUnlockStatus
  );
  // Slider value: intervals of 10, with remainder for the last step
  const maxSlider = Math.min(
    credits,
    unlockStatus?.remaining_count ?? event.total_contacts
  );

  // Build step values: [10, 20, 30, ..., max]
  const sliderSteps = useMemo(() => {
    if (maxSlider <= 0) return [];
    if (maxSlider <= 10) return [maxSlider];
    const steps: number[] = [];
    for (let i = 10; i < maxSlider; i += 10) {
      steps.push(i);
    }
    steps.push(maxSlider);
    return steps;
  }, [maxSlider]);

  const getDefaultIndex = useCallback(() => {
    if (sliderSteps.length === 0) return 0;
    const idx = sliderSteps.findIndex((s) => s >= 20);
    return idx >= 0 ? idx : sliderSteps.length - 1;
  }, [sliderSteps]);

  const [sliderIndex, setSliderIndex] = useState(getDefaultIndex);
  const sliderValue = sliderSteps[sliderIndex] ?? maxSlider;

  const router = useRouter();
  const supabase = createClient();

  const totalContacts = event.total_contacts;
  const unlockedCount = unlockStatus?.unlocked_count ?? 0;
  const remainingCount = unlockStatus?.remaining_count ?? totalContacts;

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

  // Update slider index when credits or unlock status changes
  useEffect(() => {
    setSliderIndex((prev) => Math.min(prev, sliderSteps.length - 1) || getDefaultIndex());
  }, [sliderSteps, getDefaultIndex]);

  // Refresh credits when purchase completes (from BuyCreditsModal)
  useEffect(() => {
    async function handleCreditsUpdated() {
      const { data } = await supabase.rpc("get_customer_credits");
      if (data !== null) {
        setCredits(data);
      }
    }
    window.addEventListener("credits-updated", handleCreditsUpdated);
    return () => window.removeEventListener("credits-updated", handleCreditsUpdated);
  }, [supabase]);

  // Sort preview: email contacts first, then by post_date desc
  const sortedPreviews = useMemo(() => {
    return [...previews].sort((a, b) => {
      const aHasEmail = a.email ? 1 : 0;
      const bHasEmail = b.email ? 1 : 0;
      if (aHasEmail !== bHasEmail) return bHasEmail - aHasEmail;
      const dateA = a.post_date ? new Date(a.post_date).getTime() : 0;
      const dateB = b.post_date ? new Date(b.post_date).getTime() : 0;
      return dateB - dateA;
    });
  }, [previews]);

  async function handleUnlock() {
    if (!isAuthenticated) {
      router.push(`/login?redirect=/events/${event.event_slug ?? event.event_id}`);
      return;
    }

    if (sliderValue <= 0) return;
    setUnlocking(true);
    setError(null);
    setSuccessMsg(null);

    const { data, error: rpcError } = await supabase.rpc(
      "unlock_event_contacts",
      { p_event_id: event.event_id, p_count: sliderValue }
    );

    if (rpcError) {
      setError(rpcError.message);
      setUnlocking(false);
      return;
    }

    const result = data as UnlockResult;
    if (!result.success) {
      setError(result.message);
      setUnlocking(false);
      return;
    }

    // Fire first_unlock event to Loops if this was the user's first-ever unlock
    const wasFirstUnlock =
      !unlockStatus || unlockStatus.unlocked_count === 0;
    if (wasFirstUnlock) {
      fetch("/api/loops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName: "first_unlock",
          eventId: event.event_id,
        }),
      }).catch(() => {});
    }

    // Update local state and notify sidebar
    setCredits(result.new_balance ?? 0);
    window.dispatchEvent(new CustomEvent("credits-updated"));
    setSuccessMsg(
      `${result.contacts_unlocked} contacts unlocked! ${result.new_balance} credits remaining.`
    );

    // Refresh unlock status
    const { data: newStatus } = await supabase.rpc("get_event_unlock_status", {
      p_event_id: event.event_id,
    });
    if (newStatus) {
      setUnlockStatus(newStatus as EventUnlockStatus);
    }

    setUnlocking(false);
  }

  const startDateFormatted = event.event_start_date
    ? new Date(event.event_start_date).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const isFutureEvent = event.event_start_date
    ? new Date(event.event_start_date) > new Date()
    : false;

  const showBlurredRows = remainingCount > 0;
  const costAfterUnlock = credits - sliderValue;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Back link */}
      <Link
        href={isAuthenticated ? "/dashboard/events" : "/events"}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Browse Events
      </Link>

      {/* Event Header */}
      <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {event.event_name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-zinc-500">
              {startDateFormatted && (
                <span className="flex items-center gap-1.5">
                  <svg className="h-4 w-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {startDateFormatted}
                </span>
              )}
              {event.event_location && (
                <span className="flex items-center gap-1.5">
                  <svg className="h-4 w-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {event.event_location}
                </span>
              )}
              {event.event_region && (
                <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {event.event_region}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            {event.is_active ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/10 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                Actively Collecting Data
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-600 ring-1 ring-inset ring-zinc-500/10 dark:bg-zinc-500/10 dark:text-zinc-400 dark:ring-zinc-500/20">
                Data Collection Complete
              </span>
            )}
            {isFutureEvent && (
              <span className="text-xs text-zinc-400">Event starts soon</span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4 flex flex-wrap items-center gap-6 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <div className="text-sm">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {event.total_contacts.toLocaleString()}
            </span>
            <span className="ml-1 text-zinc-400">total contacts</span>
          </div>
          <div className="text-sm">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {event.contacts_with_email.toLocaleString()}
            </span>
            <span className="ml-1 text-zinc-400">with email</span>
          </div>
          {unlockedCount > 0 && (
            <div className="text-sm">
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {unlockedCount.toLocaleString()}
              </span>
              <span className="ml-1 text-zinc-400">unlocked</span>
            </div>
          )}
        </div>

        {/* Unlock progress bar */}
        {unlockedCount > 0 && (
          <div className="mt-3">
            <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(100, (unlockedCount / totalContacts) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              {Math.min(100, Math.round((unlockedCount / totalContacts) * 100))}% unlocked
            </p>
          </div>
        )}
      </div>

      {/* "What you're missing" banner - shows after partial unlock */}
      {unlockedCount > 0 && remainingCount > 0 && unlockStatus && (
        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-900/10">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            You&apos;ve unlocked{" "}
            <strong>{unlockedCount.toLocaleString()}</strong> contacts.{" "}
            <strong>{remainingCount.toLocaleString()}</strong> more available
            {unlockStatus.contacts_with_email > unlockedCount && (
              <>, including{" "}
                <strong className="text-emerald-700 dark:text-emerald-400">
                  {Math.max(0, unlockStatus.contacts_with_email - unlockedCount).toLocaleString()}
                </strong>{" "}
                with verified emails
              </>
            )}
            .
          </p>
        </div>
      )}

      {/* Contact Preview Table */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Contacts
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {unlockedCount > 0
            ? `Showing ${FREE_PREVIEW_COUNT} preview contacts. You've unlocked ${unlockedCount.toLocaleString()} — view them in Unlocked Events.`
            : "Preview of contacts associated with this event"}
        </p>

        {loading ? (
          <div className="mt-6 flex h-48 items-center justify-center">
            <div className="flex items-center gap-3 text-sm text-zinc-400">
              <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading contacts...
            </div>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Name</th>
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Title</th>
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">LinkedIn Profile</th>
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Company</th>
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Source</th>
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Post Date</th>
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Location</th>
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Company Domain</th>
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Company LinkedIn</th>
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Industry</th>
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Size</th>
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">HQ</th>
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Founded</th>
                  <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                {/* Visible preview rows */}
                {sortedPreviews.map((c) => (
                  <ContactRow key={c.contact_id} contact={c} />
                ))}

                {/* Blurred placeholder rows */}
                {showBlurredRows && (
                  <>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <tr key={`blur-${i}`} className="select-none">
                        <td className="px-3 py-3"><div className="h-4 w-24 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-32 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-5 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-20 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-5 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-20 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-24 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-24 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-5 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-20 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-16 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-24 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-12 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                        <td className="px-3 py-3"><div className="h-4 w-28 rounded bg-zinc-200 blur-[6px] dark:bg-zinc-700" /></td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>

            {/* Unlock Section */}
            {showBlurredRows && (
              <div className="border-t border-zinc-100 bg-zinc-50/80 px-6 py-8 dark:border-zinc-800 dark:bg-zinc-900/50">
                {/* Success message */}
                {successMsg && (
                  <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
                    <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      {successMsg}
                    </div>
                    <div className="mt-3 flex gap-3">
                      <Link
                        href={`/dashboard/my-events?event=${event.event_id}`}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
                      >
                        View Unlocked Contacts
                      </Link>
                      {remainingCount > 0 && credits > 0 && (
                        <button
                          onClick={() => setSuccessMsg(null)}
                          className="cursor-pointer rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          Unlock More
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Not authenticated: prompt to sign up */}
                {!isAuthenticated && !successMsg && (
                  <div className="text-center">
                    <p className="text-sm text-zinc-500">
                      <strong className="text-zinc-900 dark:text-zinc-100">
                        {remainingCount.toLocaleString()}
                      </strong>{" "}
                      more contacts available
                    </p>
                    <p className="mt-1 text-sm text-zinc-400">
                      Sign up free to unlock contacts. You get 20 credits on us.
                    </p>
                    <Link
                      href={`/login?redirect=/events/${event.event_slug ?? event.event_id}`}
                      className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 hover:shadow-md active:scale-[0.98]"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                      Sign Up to Unlock
                    </Link>
                  </div>
                )}

                {/* Authenticated with credits: slider unlock */}
                {isAuthenticated && credits > 0 && remainingCount > 0 && !successMsg && (
                  <div className="mx-auto max-w-lg">
                    <p className="text-center text-sm text-zinc-500">
                      <strong className="text-zinc-900 dark:text-zinc-100">
                        {remainingCount.toLocaleString()}
                      </strong>{" "}
                      more contacts available
                    </p>

                    {/* Slider */}
                    <div className="mt-5">
                      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        How many contacts to unlock?
                      </label>
                      <div className="mt-2 flex items-center gap-4">
                        <span className="text-xs text-zinc-400">{sliderSteps[0] ?? 1}</span>
                        <input
                          type="range"
                          min={0}
                          max={sliderSteps.length - 1}
                          value={sliderIndex}
                          onChange={(e) => setSliderIndex(Number(e.target.value))}
                          className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-200 accent-emerald-600 dark:bg-zinc-700"
                        />
                        <span className="text-xs text-zinc-400">{maxSlider}</span>
                      </div>
                      <p className="mt-1 text-center text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                        {sliderValue} contact{sliderValue !== 1 ? "s" : ""}
                      </p>
                    </div>

                    {/* Cost breakdown */}
                    <div className="mt-4 rounded-xl bg-white p-3 ring-1 ring-zinc-200 dark:bg-zinc-800/50 dark:ring-zinc-700">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-zinc-500">Cost</span>
                        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {sliderValue} credit{sliderValue !== 1 ? "s" : ""}
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
                        <span
                          className={`font-semibold ${
                            costAfterUnlock <= 5
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {costAfterUnlock} remaining
                        </span>
                      </div>
                    </div>

                    {/* Unlock button */}
                    <button
                      onClick={handleUnlock}
                      disabled={unlocking || sliderValue <= 0}
                      className="mt-4 w-full cursor-pointer rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {unlocking
                        ? "Unlocking..."
                        : `Unlock ${sliderValue} Contact${sliderValue !== 1 ? "s" : ""}`}
                    </button>

                    <p className="mt-2 text-center text-xs text-zinc-400">
                      Best contacts first: email-verified, then most recent
                    </p>

                    {error && (
                      <p className="mt-3 text-center text-sm text-red-600 dark:text-red-400">
                        {error}
                      </p>
                    )}
                  </div>
                )}

                {/* Authenticated but no credits */}
                {isAuthenticated && credits <= 0 && remainingCount > 0 && !successMsg && (
                  <div className="text-center">
                    <p className="text-sm text-zinc-500">
                      <strong className="text-zinc-900 dark:text-zinc-100">
                        {remainingCount.toLocaleString()}
                      </strong>{" "}
                      more contacts available
                    </p>
                    <p className="mt-1 text-sm text-zinc-400">
                      You&apos;ve used all your free credits. Get more to keep unlocking.
                    </p>
                    <button
                      onClick={() => {
                        setShowBuyCredits(true);
                      }}
                      className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 hover:shadow-md active:scale-[0.98]"
                    >
                      Get More Credits
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Buy Credits Modal — embedded so it works on both dashboard and public pages */}
      {showBuyCredits && userEmail && (
        <BuyCreditsModal
          userEmail={userEmail}
          onClose={() => setShowBuyCredits(false)}
        />
      )}
    </div>
  );
}

// Extracted row component to keep the table clean
function ContactRow({ contact: c }: { contact: ContactPreview }) {
  return (
    <tr className="transition-colors hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
      <td className="whitespace-nowrap px-3 py-3 font-medium text-zinc-900 dark:text-zinc-100">
        {c.full_name ?? "\u2014"}
      </td>
      <td className="max-w-48 truncate px-3 py-3 text-zinc-500">
        {c.current_title ?? "\u2014"}
      </td>
      <td className="whitespace-nowrap px-3 py-3">
        {c.contact_linkedin_url &&
        !c.contact_linkedin_url.startsWith("placeholder") ? (
          <a
            href={c.contact_linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-[#0A66C2] transition-opacity hover:opacity-70"
            title="LinkedIn Profile"
          >
            <LinkedInIcon className="h-4.5 w-4.5" />
          </a>
        ) : (
          <span className="text-zinc-300 dark:text-zinc-600">{"\u2014"}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
        {c.company_name ?? "\u2014"}
      </td>
      <td className="whitespace-nowrap px-3 py-3">
        {c.post_url ? (
          <a
            href={c.post_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-emerald-600 transition-colors hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            View Post
          </a>
        ) : (
          <span className="text-zinc-300 dark:text-zinc-600">{"\u2014"}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-zinc-400">
        {formatPostDate(c.post_date)}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-zinc-400">
        {[c.city, c.country].filter(Boolean).join(", ") || "\u2014"}
      </td>
      <td className="px-3 py-3">
        {c.company_domain ? (
          <a
            href={`https://${c.company_domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {c.company_domain}
          </a>
        ) : (
          <span className="text-zinc-300 dark:text-zinc-600">{"\u2014"}</span>
        )}
      </td>
      <td className="px-3 py-3">
        {c.company_linkedin_url ? (
          <a
            href={c.company_linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex text-[#0A66C2] transition-opacity hover:opacity-70"
            title="Company LinkedIn"
          >
            <LinkedInIcon className="h-4.5 w-4.5" />
          </a>
        ) : (
          <span className="text-zinc-300 dark:text-zinc-600">{"\u2014"}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
        {c.company_industry ?? "\u2014"}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-zinc-400">
        {c.company_size ?? "\u2014"}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-zinc-400">
        {c.company_headquarters ?? "\u2014"}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-zinc-400">
        {c.company_founded_year ?? "\u2014"}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
        {c.email ?? "\u2014"}
      </td>
    </tr>
  );
}
