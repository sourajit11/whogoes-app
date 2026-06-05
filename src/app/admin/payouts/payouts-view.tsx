"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminAffiliate } from "@/types/admin";

function usd(n: number) {
  return "$" + (n ?? 0).toFixed(2);
}

const THRESHOLD = 100;

export default function PayoutsView({ affiliates }: { affiliates: AdminAffiliate[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function markPaid(a: AdminAffiliate) {
    const reference = window.prompt(`Mark ${usd(a.pending_balance_usd)} paid to ${a.email}. Reference (transaction id / note)?`) ?? "";
    setBusy(a.affiliate_id);
    await fetch("/admin/api/mark-payout-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ affiliate_id: a.affiliate_id, method: "", reference }),
    });
    setBusy(null);
    router.refresh();
  }

  const eligible = affiliates.filter((a) => a.pending_balance_usd >= THRESHOLD);
  const belowThreshold = affiliates.filter((a) => a.pending_balance_usd < THRESHOLD);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Payouts</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Affiliates at or above the {usd(THRESHOLD)} threshold are ready to be paid. Marking paid records a payout and resets their pending balance.
      </p>

      <Group title={`Ready to pay (${eligible.length})`} rows={eligible} busy={busy} onPay={markPaid} payable />
      <Group title={`Below threshold (${belowThreshold.length})`} rows={belowThreshold} busy={busy} onPay={markPaid} />
    </div>
  );
}

function Group({
  title,
  rows,
  busy,
  onPay,
  payable,
}: {
  title: string;
  rows: AdminAffiliate[];
  busy: string | null;
  onPay: (a: AdminAffiliate) => void;
  payable?: boolean;
}) {
  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">None.</p>
      ) : (
        <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-400 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2.5 font-medium">Affiliate</th>
                <th className="px-4 py-2.5 text-right font-medium">Pending</th>
                <th className="px-4 py-2.5 text-right font-medium">Paying customers</th>
                <th className="px-4 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((a) => (
                <tr key={a.affiliate_id} className="bg-white dark:bg-zinc-900">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/affiliates/${a.affiliate_id}`} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">{a.email}</Link>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">{usd(a.pending_balance_usd)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{a.paying_count}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      disabled={busy === a.affiliate_id}
                      onClick={() => onPay(a)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${payable ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"}`}
                    >
                      Mark paid
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
