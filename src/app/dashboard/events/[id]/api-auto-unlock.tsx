"use client";

import Link from "next/link";
import { useState } from "react";

interface InitialSubscription {
  auto_unlock_enabled: boolean;
  max_unlocks_per_event: number | null;
}

interface Props {
  eventId: string;
  apiEligible: boolean;
  hasApiKey: boolean;
  initial: InitialSubscription | null;
}

function ApiIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 7l-3 3 3 3M15 7l3 3-3 3M12 5l-4 10" />
    </svg>
  );
}

export default function ApiAutoUnlock({
  eventId,
  apiEligible,
  hasApiKey,
  initial,
}: Props) {
  const [enabled, setEnabled] = useState<boolean>(
    initial?.auto_unlock_enabled ?? false,
  );
  const [capInput, setCapInput] = useState<string>(
    initial?.max_unlocks_per_event != null
      ? String(initial.max_unlocks_per_event)
      : "",
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Free user — single inline link, no card.
  if (!apiEligible) {
    return (
      <p className="text-xs text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <ApiIcon className="h-3.5 w-3.5" />
          Auto-unlock via API
        </span>{" "}
        ·{" "}
        <Link
          href="/dashboard/billing"
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          Buy credits to enable
        </Link>
      </p>
    );
  }

  // Paid but no key — same compact one-liner.
  if (!hasApiKey) {
    return (
      <p className="text-xs text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <ApiIcon className="h-3.5 w-3.5" />
          Auto-unlock via API
        </span>{" "}
        ·{" "}
        <Link
          href="/dashboard/integrations"
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          Generate an API key
        </Link>
      </p>
    );
  }

  async function persist(next: {
    auto_unlock_enabled?: boolean;
    max_unlocks_per_event?: number | null;
  }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/internal/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId, ...next }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error ?? "Failed to save");
        return;
      }
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2000);
    } finally {
      setSaving(false);
    }
  }

  function onToggle(nextEnabled: boolean) {
    setEnabled(nextEnabled);
    void persist({ auto_unlock_enabled: nextEnabled });
  }

  function onCapBlur() {
    if (capInput.trim() === "") {
      void persist({ max_unlocks_per_event: null });
      return;
    }
    const n = Number(capInput);
    if (!Number.isInteger(n) || n < 0) {
      setError("Cap must be a non-negative whole number, or empty for no cap.");
      return;
    }
    void persist({ max_unlocks_per_event: n });
  }

  // The compact bar: one line, subtle, fits visually with the metadata row above.
  return (
    <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
      <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
        <ApiIcon className="h-3.5 w-3.5 text-zinc-400" />
        Auto-unlock via API
      </span>

      <button
        type="button"
        onClick={() => onToggle(!enabled)}
        disabled={saving}
        aria-pressed={enabled}
        aria-label="Toggle auto-unlock"
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          enabled ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-600"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            enabled ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </button>

      {enabled && (
        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          Max
          <input
            type="number"
            min={0}
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            onBlur={onCapBlur}
            placeholder="No cap"
            className="w-20 rounded border border-zinc-300 px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          contacts
        </span>
      )}

      {error ? (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      ) : savedAt ? (
        <span className="text-xs text-emerald-600 dark:text-emerald-400">
          Saved
        </span>
      ) : (
        <Link
          href="/docs/api"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          Docs ↗
        </Link>
      )}
    </div>
  );
}
