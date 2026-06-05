"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AffiliateReferral } from "../types";

function usd(n: number) {
  return "$" + (n ?? 0).toFixed(2);
}

export default function AffiliateReferralsPage() {
  const supabase = createClient();
  const [referrals, setReferrals] = useState<AffiliateReferral[] | null>(null);

  useEffect(() => {
    supabase.rpc("affiliate_get_dashboard").then(({ data }) => {
      if (data) setReferrals((data.referrals ?? []) as AffiliateReferral[]);
    });
  }, [supabase]);

  if (!referrals) {
    return <div className="p-8 text-sm text-zinc-500">Loading...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Referrals</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Everyone you&apos;ve referred and what you&apos;ve earned from them. Emails you submitted are shown in full; link signups are masked for privacy.
      </p>

      {referrals.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">No referrals yet.</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-400 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2.5 font-medium">Referral</th>
                <th className="px-4 py-2.5 font-medium">Source</th>
                <th className="px-4 py-2.5 font-medium">Signed up</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Earned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {referrals.map((r) => (
                <tr key={r.id} className="bg-white dark:bg-zinc-900">
                  <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">{r.email ?? "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{r.source === "email_match" ? "Email" : "Link"}</td>
                  <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{new Date(r.referred_at).toLocaleDateString()}</td>
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
  );
}
