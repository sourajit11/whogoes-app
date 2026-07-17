"use client";

import { useState } from "react";

interface RequestEventModalProps {
  /** Pre-fills the event name, e.g. with the user's current search query. */
  initialName?: string;
  /** When false, we collect the requester's email in the form. */
  isAuthenticated?: boolean;
  onClose: () => void;
}

type State = "form" | "sending" | "error";

export default function RequestEventModal({
  initialName = "",
  isAuthenticated = false,
  onClose,
}: RequestEventModalProps) {
  const [eventName, setEventName] = useState(initialName);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<State>("form");
  const [errorMsg, setErrorMsg] = useState("");
  const [sent, setSent] = useState(false);

  const needsEmail = !isAuthenticated;

  // The Browse page is also proxied under the apex marketing domain
  // (whogoes.co/events), which doesn't route /api/*. From there we must call the
  // app domain directly (CORS-enabled); everywhere else a relative path works.
  function requestEventUrl() {
    if (typeof window !== "undefined") {
      const host = window.location.hostname;
      if (host === "whogoes.co" || host === "www.whogoes.co") {
        return "https://app.whogoes.co/api/request-event";
      }
    }
    return "/api/request-event";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!eventName.trim() || state === "sending") return;
    if (needsEmail && !email.includes("@")) {
      setState("error");
      setErrorMsg("Please enter a valid email so we can follow up.");
      return;
    }
    setState("sending");
    setErrorMsg("");
    try {
      const res = await fetch(requestEventUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName: eventName.trim(),
          note: note.trim(),
          ...(needsEmail ? { email: email.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState("error");
        setErrorMsg(data?.error || "Something went wrong. Please try again.");
        return;
      }
      setSent(true);
    } catch {
      setState("error");
      setErrorMsg("Couldn't reach the server. Check your connection and try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative mx-4 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl sm:p-8 dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 cursor-pointer rounded-lg p-1 text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {sent ? (
          <div className="py-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <svg className="h-6 w-6 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Request received
            </h2>
            <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
              Thanks. We&apos;ll start pulling the attendee list for{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {eventName.trim()}
              </span>{" "}
              and let you know when it&apos;s ready.
            </p>
            <button
              onClick={onClose}
              className="mt-6 cursor-pointer rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Request an event
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Tell us which trade show or event you need, and we&apos;ll start
              building its attendee list.
            </p>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Event name
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  maxLength={200}
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="e.g. Web Summit 2026"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>

              {needsEmail && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Your email
                  </label>
                  <input
                    type="email"
                    required
                    maxLength={200}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                  <p className="mt-1 text-xs text-zinc-400">
                    So we can let you know when the list is ready.
                  </p>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Anything else? <span className="text-zinc-400">(optional)</span>
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="City, dates, or a link to the event"
                  className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>

              {state === "error" && errorMsg && (
                <p className="text-xs text-red-600 dark:text-red-400">{errorMsg}</p>
              )}

              <button
                type="submit"
                disabled={!eventName.trim() || state === "sending"}
                className="w-full cursor-pointer rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {state === "sending" ? "Sending..." : "Send request"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
