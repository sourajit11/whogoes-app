"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import StatCard from "@/app/dashboard/components/stat-card";
import ReferralQr from "../components/referral-qr";
import type { AffiliateDashboard } from "./types";

function usd(n: number) {
  return "$" + (n ?? 0).toFixed(2);
}

export default function AffiliateOverviewPage() {
  const supabase = createClient();
  const [data, setData] = useState<AffiliateDashboard | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase.rpc("affiliate_get_dashboard").then(({ data }) => {
      if (data) setData(data as AffiliateDashboard);
    });
  }, [supabase]);

  if (!data) {
    return <div className="p-8 text-sm text-zinc-500">Loading...</div>;
  }

  const link = data.referral_code
    ? `https://app.whogoes.co/events?ref=${data.referral_code}`
    : "";
  const threshold = data.payout_threshold_usd || 100;
  const progress = Math.min(100, Math.round((data.pending_balance_usd / threshold) * 100));

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
        Affiliate Dashboard
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        You earn 30% on every credit purchase your referrals make, forever.
      </p>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pending balance" value={usd(data.pending_balance_usd)} accent="emerald" subtitle={`Paid out: ${usd(data.paid_balance_usd)}`} />
        <StatCard label="Total earned" value={usd(data.total_earned_usd)} />
        <StatCard label="Signups referred" value={data.signups} accent="blue" />
        <StatCard label="Paying customers" value={data.paying_customers} accent="indigo" />
      </div>

      {/* Payout progress */}
      <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Progress to {usd(threshold)} payout
          </span>
          <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
            {usd(data.pending_balance_usd)} / {usd(threshold)}
          </span>
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          Payouts are released once your pending balance reaches {usd(threshold)}.{" "}
          <Link href="/affiliate/payouts" className="text-emerald-600 hover:underline">Add your payout details</Link>.
        </p>
      </div>

      {/* Referral link */}
      <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Your referral link</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Share this link. Anyone who signs up through it within 90 days is tracked to you.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            readOnly
            value={link}
            className="flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
          />
          <button
            onClick={() => {
              navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-3 text-xs text-zinc-400">
          Prefer to add contacts directly?{" "}
          <Link href="/affiliate/contacts" className="text-emerald-600 hover:underline">Submit prospect emails</Link>{" "}
          and we&apos;ll match them when they sign up.
        </p>
        <ReferralQr url={link} />
      </div>

      {/* Recent referrals */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Recent referrals</h2>
        {data.referrals.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No referrals yet. Share your link or add contacts to get started.</p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-400 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Referral</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.referrals.slice(0, 8).map((r) => (
                  <tr key={r.id} className="bg-white dark:bg-zinc-900">
                    <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">{r.email ?? "—"}</td>
                    <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{r.source === "email_match" ? "Email" : "Link"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.first_purchase_at ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"}`}>
                        {r.first_purchase_at ? "Paying" : "Signed up"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700 dark:text-zinc-300">{usd(r.earned_usd)}</td>
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
