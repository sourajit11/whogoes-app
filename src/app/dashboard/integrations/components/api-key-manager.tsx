"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ApiKeyDisplay } from "@/types";

interface Props {
  initialKeys: ApiKeyDisplay[];
}

export default function ApiKeyManager({ initialKeys }: Props) {
  const [keys, setKeys] = useState<ApiKeyDisplay[]>(initialKeys);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [dailyCapInput, setDailyCapInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const dailyCap =
        dailyCapInput.trim() === "" ? null : Number(dailyCapInput);
      if (
        dailyCap !== null &&
        (!Number.isInteger(dailyCap) || dailyCap < 0)
      ) {
        setError("Daily cap must be a non-negative whole number, or empty for unlimited.");
        return;
      }

      const res = await fetch("/api/internal/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: keyName || "Default",
          daily_credit_cap: dailyCap,
        }),
      });
      const result = await res.json();

      if (!res.ok || result.error) {
        setError(result.error ?? "Failed to create key");
        return;
      }

      if (result.rawKey) {
        setNewRawKey(result.rawKey);
        setKeys((prev) => [result.key as ApiKeyDisplay, ...prev]);
        setKeyName("");
        setDailyCapInput("");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(keyId: string) {
    if (
      !confirm(
        "Revoke this API key? Any integrations using it will stop working immediately.",
      )
    ) {
      return;
    }
    const { error: revokeErr } = await supabase
      .from("api_keys")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("id", keyId);
    if (!revokeErr) {
      setKeys((prev) =>
        prev.map((k) =>
          k.id === keyId
            ? { ...k, is_active: false, revoked_at: new Date().toISOString() }
            : k,
        ),
      );
    }
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-8 space-y-6">
      {newRawKey && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Copy your API key now. It will not be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white px-3 py-2 font-mono text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
              {newRawKey}
            </code>
            <button
              onClick={() => copyToClipboard(newRawKey)}
              className="shrink-0 rounded-md bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setNewRawKey(null)}
            className="mt-2 text-xs text-amber-700 hover:underline dark:text-amber-400"
          >
            I saved it, dismiss
          </button>
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Create API Key
        </h3>
        <p className="mt-1 text-xs text-zinc-400">
          Generate a key to access the WhoGoes API. Max 5 active keys.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_180px_auto]">
          <input
            type="text"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Key name (e.g., Production)"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <input
            type="number"
            min={0}
            value={dailyCapInput}
            onChange={(e) => setDailyCapInput(e.target.value)}
            placeholder="Daily credit cap (optional)"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? "Generating..." : "Generate Key"}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        <p className="mt-2 text-xs text-zinc-400">
          Daily cap limits how many credits this key can spend per UTC day.
          Leave empty for no cap.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Your API Keys
          </h3>
        </div>
        {keys.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-zinc-400">
            No API keys yet. Create one above.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {key.name}
                  </p>
                  <p className="font-mono text-xs text-zinc-400">
                    {key.key_prefix}...
                  </p>
                  <p className="text-xs text-zinc-400">
                    Created {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used_at &&
                      ` · Last used ${new Date(
                        key.last_used_at,
                      ).toLocaleDateString()}`}
                    {key.daily_credit_cap !== null &&
                      ` · Daily cap: ${key.daily_credit_cap}`}
                  </p>
                </div>
                <div>
                  {key.is_active ? (
                    <button
                      onClick={() => handleRevoke(key.id)}
                      className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      Revoke
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-400">Revoked</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
