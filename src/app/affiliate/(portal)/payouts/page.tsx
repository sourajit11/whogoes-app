"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AffiliateDashboard, AffiliatePayout } from "../types";

function usd(n: number) {
  return "$" + (n ?? 0).toFixed(2);
}

export default function AffiliatePayoutsPage() {
  const supabase = createClient();
  const [data, setData] = useState<AffiliateDashboard | null>(null);
  const [method, setMethod] = useState("paypal");
  const [info, setInfo] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const { data } = await supabase.rpc("affiliate_get_dashboard");
    if (data) {
      const d = data as AffiliateDashboard;
      setData(d);
      if (d.payout_method) setMethod(d.payout_method);
      const existing = d.payout_details as { info?: string } | null;
      if (existing?.info) setInfo(existing.info);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    setSaving(true);
    const { data: res, error } = await supabase.rpc("affiliate_update_payout", {
      p_method: method,
      p_details: { info },
    });
    if (error || (res && !res.success)) {
      setError(error?.message || res?.message || "Could not save.");
      setSaving(false);
      return;
    }
    setSaved(true);
    setSaving(false);
  }

  if (!data) {
    return <div className="p-8 text-sm text-zinc-500">Loading...</div>;
  }

  const threshold = data.payout_threshold_usd || 100;
  const eligible = data.pending_balance_usd >= threshold;
  const payouts = (data.payouts ?? []) as AffiliatePayout[];

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Payouts</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        We pay out once your pending balance reaches {usd(threshold)}.
      </p>

      {/* Balance */}
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Pending balance</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{usd(data.pending_balance_usd)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Paid to date</p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{usd(data.paid_balance_usd)}</p>
          </div>
        </div>
        <p className={`mt-3 text-sm ${eligible ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}`}>
          {eligible
            ? "You've hit the payout threshold. We'll send your payment to the details below."
            : `${usd(threshold - data.pending_balance_usd)} to go until your next payout.`}
        </p>
      </div>

      {/* Payout details */}
      <form onSubmit={handleSave} className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Payout details</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Where should we send your money?</p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
              <option value="paypal">PayPal</option>
              <option value="wise">Wise</option>
              <option value="bank">Bank transfer</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Details</label>
            <textarea value={info} onChange={(e) => setInfo(e.target.value)} rows={3}
              placeholder="PayPal email, bank account, or other payout details"
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" />
          </div>
        </div>
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {saved && <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">Saved.</p>}
        <button type="submit" disabled={saving}
          className="mt-3 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
          {saving ? "Saving..." : "Save payout details"}
        </button>
      </form>

      {/* History */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Payout history</h2>
        {payouts.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No payouts yet.</p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-400 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Method</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {payouts.map((p, i) => (
                  <tr key={i} className="bg-white dark:bg-zinc-900">
                    <td className="px-4 py-2.5 tabular-nums text-zinc-700 dark:text-zinc-300">{usd(p.amount_usd)}</td>
                    <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{p.method ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">{p.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{new Date(p.paid_at ?? p.created_at).toLocaleDateString()}</td>
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
