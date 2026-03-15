"use client";

import { useState } from "react";
import Link from "next/link";
import StatCard from "@/app/dashboard/components/stat-card";
import type { AdminCustomerSubscription, AdminCustomerUnlock } from "@/types/admin";

interface CustomerDetailProps {
  userId: string;
  email: string;
  signedUpAt: string;
  freeCredits: number;
  paidCredits: number;
  subscriptions: AdminCustomerSubscription[];
  recentUnlocks: AdminCustomerUnlock[];
  monthlyBreakdown: { month: string; credits_used: number }[];
}

export default function CustomerDetail({
  userId,
  email,
  signedUpAt,
  freeCredits,
  paidCredits,
  subscriptions,
  recentUnlocks,
  monthlyBreakdown,
}: CustomerDetailProps) {
  const totalBalance = freeCredits + paidCredits;
  const [newBalance, setNewBalance] = useState(paidCredits);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustMessage, setAdjustMessage] = useState("");

  async function handleAdjustCredits() {
    setAdjusting(true);
    setAdjustMessage("");
    try {
      const res = await fetch("/admin/api/adjust-credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, new_balance: newBalance }),
      });
      const data = await res.json();
      if (data.success) {
        setAdjustMessage(`Credits updated to ${newBalance}`);
      } else {
        setAdjustMessage(data.message || "Failed to update credits");
      }
    } catch {
      setAdjustMessage("Error updating credits");
    } finally {
      setAdjusting(false);
    }
  }

  const totalCreditsUsed = recentUnlocks.length;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-zinc-400">
        <Link href="/admin/customers" className="hover:text-indigo-500">
          Customers
        </Link>
        <span>/</span>
        <span className="text-zinc-600 dark:text-zinc-300">{email}</span>
      </div>

      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        {email}
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Signed up {new Date(signedUpAt).toLocaleDateString()}
      </p>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Total Credits" value={totalBalance} accent="indigo" />
        <StatCard label="Free Credits" value={freeCredits} />
        <StatCard label="Paid Credits" value={paidCredits} accent="emerald" />
        <StatCard label="Contacts Unlocked" value={totalCreditsUsed} />
        <StatCard
          label="Last Activity"
          value={
            recentUnlocks.length > 0
              ? new Date(recentUnlocks[0].charged_at).toLocaleDateString()
              : "Never"
          }
        />
      </div>

      {/* Credit Adjustment */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Adjust Paid Credits
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          Sets the paid credits balance in the customers table. Free trial credits ({freeCredits} remaining) are managed separately.
        </p>
        <div className="mt-3 flex items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-500">
              New Paid Balance
            </label>
            <input
              type="number"
              min={0}
              value={newBalance}
              onChange={(e) => setNewBalance(parseInt(e.target.value) || 0)}
              className="mt-1 w-32 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <button
            onClick={handleAdjustCredits}
            disabled={adjusting || newBalance === paidCredits}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {adjusting ? "Saving..." : "Save"}
          </button>
          {adjustMessage && (
            <span className="text-sm text-zinc-500">{adjustMessage}</span>
          )}
        </div>
      </div>

      {/* Two-column: Subscriptions + Monthly Usage */}
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {/* Subscribed Events */}
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Subscribed Events ({subscriptions.length})
          </h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Event
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Subscribed
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                {subscriptions.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-sm text-zinc-400">
                      No subscriptions
                    </td>
                  </tr>
                ) : (
                  subscriptions.map((sub) => (
                    <tr key={sub.event_id} className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/events/${sub.event_id}`}
                          className="font-medium text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
                        >
                          {sub.event_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        {new Date(sub.subscribed_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        {sub.is_paused ? (
                          <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/10 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20">
                            Paused
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/10 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20">
                            Active
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Monthly Usage */}
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Monthly Usage
          </h2>
          <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Month
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Credits Used
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                {monthlyBreakdown.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-6 text-center text-sm text-zinc-400">
                      No usage yet
                    </td>
                  </tr>
                ) : (
                  monthlyBreakdown.map((row) => (
                    <tr key={row.month} className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30">
                      <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100">
                        {row.month}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-zinc-500">
                        {row.credits_used}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recent Unlocks */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Recent Unlocks ({recentUnlocks.length})
        </h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Contact
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Email
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Event
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Unlocked At
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {recentUnlocks.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-zinc-400">
                    No unlocks yet
                  </td>
                </tr>
              ) : (
                recentUnlocks.map((unlock) => (
                  <tr
                    key={`${unlock.contact_id}-${unlock.charged_at}`}
                    className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                  >
                    <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100">
                      {unlock.contact_name ?? "Unknown"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {unlock.contact_email ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {unlock.event_name}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {new Date(unlock.charged_at).toLocaleDateString()}
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
