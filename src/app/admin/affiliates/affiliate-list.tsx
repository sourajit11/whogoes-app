"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminAffiliate } from "@/types/admin";

function usd(n: number) {
  return "$" + (n ?? 0).toFixed(2);
}

export default function AffiliateList({ affiliates }: { affiliates: AdminAffiliate[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const pending = affiliates.filter((a) => a.status === "pending");
  const others = affiliates.filter((a) => a.status !== "pending");

  async function act(endpoint: string, affiliate_id: string) {
    setBusy(affiliate_id);
    await fetch(`/admin/api/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ affiliate_id }),
    });
    setBusy(null);
    router.refresh();
  }

  const statusBadge = (status: string) => {
    if (status === "active") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400";
    if (status === "suspended") return "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400";
    return "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400";
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Affiliates</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Approve applicants, track referred paying customers, and manage the program.
      </p>

      {/* Pending approvals */}
      {pending.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Pending approval ({pending.length})</h2>
          <div className="mt-2 overflow-hidden rounded-xl border border-amber-200 dark:border-amber-900/40">
            <table className="w-full text-sm">
              <thead className="bg-amber-50 text-left text-xs uppercase tracking-wider text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Applied</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {pending.map((a) => (
                  <tr key={a.affiliate_id} className="bg-white dark:bg-zinc-900">
                    <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">{a.email}</td>
                    <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{a.display_name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{new Date(a.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        disabled={busy === a.affiliate_id}
                        onClick={() => act("approve-affiliate", a.affiliate_id)}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* All affiliates */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">All affiliates</h2>
        {others.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No active affiliates yet.</p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-400 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Code</th>
                  <th className="px-4 py-2.5 text-right font-medium">Signups</th>
                  <th className="px-4 py-2.5 text-right font-medium">Paying</th>
                  <th className="px-4 py-2.5 text-right font-medium">Pending</th>
                  <th className="px-4 py-2.5 text-right font-medium">Earned</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {others.map((a) => (
                  <tr key={a.affiliate_id} className="bg-white transition-colors hover:bg-zinc-50/70 dark:bg-zinc-900 dark:hover:bg-zinc-800/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/admin/affiliates/${a.affiliate_id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">{a.email}</Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(a.status)}`}>{a.status}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">{a.referral_code ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{a.referral_count}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{a.paying_count}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{usd(a.pending_balance_usd)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{usd(a.total_earned_usd)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {a.status === "active" ? (
                        <button disabled={busy === a.affiliate_id} onClick={() => act("suspend-affiliate", a.affiliate_id)}
                          className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700">
                          Suspend
                        </button>
                      ) : a.status === "suspended" ? (
                        <button disabled={busy === a.affiliate_id} onClick={() => act("approve-affiliate", a.affiliate_id)}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
                          Reactivate
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
