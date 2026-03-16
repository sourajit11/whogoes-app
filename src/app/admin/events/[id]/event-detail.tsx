"use client";

import { useState } from "react";
import Link from "next/link";
import StatCard from "@/app/dashboard/components/stat-card";
import type { AdminDataQuality } from "@/types/admin";

interface EventDetailProps {
  event: {
    id: string;
    name: string;
    year: number;
    region?: string | null;
    location?: string | null;
    start_date?: string | null;
    is_active: boolean;
  };
  quality: AdminDataQuality | null;
  subscribers: {
    user_id: string;
    email: string;
    subscribed_at: string;
    is_paused: boolean;
    unlocks: number;
  }[];
}

function QualityBadge({ rate }: { rate: number }) {
  if (rate >= 80) {
    return (
      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
        {rate}%
      </span>
    );
  }
  if (rate >= 50) {
    return (
      <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
        {rate}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/10 dark:text-red-400">
      {rate}%
    </span>
  );
}

export default function EventDetail({
  event,
  quality,
  subscribers,
}: EventDetailProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(event.name);
  const [isActive, setIsActive] = useState(event.is_active);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  async function handleSave() {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("/admin/api/update-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          name: name,
          is_active: isActive,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSaveMsg("Saved");
        setEditing(false);
      } else {
        setSaveMsg(data.message || "Failed to save");
      }
    } catch {
      setSaveMsg("Error saving");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-zinc-400">
        <Link href="/admin/events" className="hover:text-indigo-500">
          Events
        </Link>
        <span>/</span>
        <span className="text-zinc-600 dark:text-zinc-300">{event.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          {editing ? (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xl font-bold text-zinc-900 outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          ) : (
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {name}
            </h1>
          )}
          <p className="mt-1 text-sm text-zinc-400">
            {event.year}
            {event.location && ` · ${event.location}`}
            {event.region && ` · ${event.region}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-zinc-300"
                />
                Active
              </label>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => { setEditing(false); setName(event.name); setIsActive(event.is_active); }}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Edit
            </button>
          )}
          {saveMsg && <span className="text-sm text-zinc-500">{saveMsg}</span>}
        </div>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Contacts" value={quality?.total_contacts ?? 0} />
        <StatCard label="With Email" value={quality?.with_email ?? 0} accent="emerald" />
        <StatCard label="Subscribers" value={subscribers.length} accent="indigo" />
        <StatCard
          label="Status"
          value={isActive ? "Active" : "Completed"}
          accent={isActive ? "emerald" : undefined}
        />
      </div>

      {/* Data Quality */}
      {quality && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Data Quality
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Email", value: quality.with_email, rate: quality.email_rate },
              { label: "LinkedIn", value: quality.with_linkedin, rate: quality.linkedin_rate },
              { label: "Company", value: quality.with_company, rate: quality.total_contacts > 0 ? Math.round(100 * quality.with_company / quality.total_contacts) : 0 },
              { label: "Title", value: quality.with_title, rate: quality.total_contacts > 0 ? Math.round(100 * quality.with_title / quality.total_contacts) : 0 },
              { label: "Post URL", value: quality.with_post_url, rate: quality.total_contacts > 0 ? Math.round(100 * quality.with_post_url / quality.total_contacts) : 0 },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                  {item.label}
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                  {item.value.toLocaleString()}
                </p>
                <div className="mt-1">
                  <QualityBadge rate={item.rate} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscribers */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Subscribers ({subscribers.length})
        </h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Customer
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Subscribed
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Unlocks
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {subscribers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-zinc-400">
                    No subscribers yet
                  </td>
                </tr>
              ) : (
                subscribers.map((sub) => (
                  <tr key={sub.user_id} className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/customers/${sub.user_id}`}
                        className="font-medium text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
                      >
                        {sub.email}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {new Date(sub.subscribed_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {sub.is_paused ? (
                        <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                          Paused
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-zinc-500">
                      {sub.unlocks}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
