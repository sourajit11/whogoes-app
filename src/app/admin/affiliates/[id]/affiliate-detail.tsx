"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AdminAffiliateDetail } from "@/types/admin";

function usd(n: number) {
  return "$" + (n ?? 0).toFixed(2);
}

export default function AffiliateDetail({
  affiliateId,
  detail,
}: {
  affiliateId: string;
  detail: AdminAffiliateDetail;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const a = detail.affiliate;
  const payoutDetails = a.payout_details as { info?: string } | null;
  const [limit, setLimit] = useState(a.daily_contact_limit ?? 10);
  const [limitSaved, setLimitSaved] = useState(false);

  async function saveLimit() {
    setBusy(true);
    setLimitSaved(false);
    await fetch("/admin/api/set-contact-limit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ affiliate_id: affiliateId, limit: Number(limit) }),
    });
    setBusy(false);
    setLimitSaved(true);
    router.refresh();
  }

  async function markPaid() {
    const reference = window.prompt("Payout reference (transaction id / note)?") ?? "";
    setBusy(true);
    await fetch("/admin/api/mark-payout-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ affiliate_id: affiliateId, method: a.payout_method ?? "", reference }),
    });
    setBusy(false);
    router.refresh();
  }

  async function voidCommission(commission_id: string) {
    if (!window.confirm("Void this commission? It reverses the affiliate's pending balance.")) return;
    setBusy(true);
    await fetch("/admin/api/void-commission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commission_id }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Link href="/admin/affiliates" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">← Back to affiliates</Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{a.email}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {a.display_name ?? "—"} · <span className="font-mono">{a.referral_code ?? "no code"}</span> · {a.status}
          </p>
        </div>
        {a.pending_balance_usd > 0 && (
          <button onClick={markPaid} disabled={busy}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
            Mark {usd(a.pending_balance_usd)} paid
          </button>
        )}
      </div>

      {/* Balances + payout details */}
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Pending</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{usd(a.pending_balance_usd)}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Paid to date</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{usd(a.paid_balance_usd)}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">Total earned</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">{usd(a.total_earned_usd)}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Payout: </span>
        <span className="text-zinc-600 dark:text-zinc-400">
          {a.payout_method ? `${a.payout_method} — ${payoutDetails?.info ?? "no details"}` : "Not provided"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Daily contact limit:</span>
        <input
          type="number"
          min={0}
          max={1000}
          value={limit}
          onChange={(e) => { setLimit(Number(e.target.value)); setLimitSaved(false); }}
          className="w-24 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          onClick={saveLimit}
          disabled={busy}
          className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
        >
          Save
        </button>
        {limitSaved && <span className="text-emerald-600 dark:text-emerald-400">Saved</span>}
        <span className="text-xs text-zinc-400">Default 10. Raise for trusted affiliates.</span>
      </div>

      {/* Commissions */}
      <Section title={`Commissions (${detail.commissions.length})`}>
        {detail.commissions.length === 0 ? <Empty /> : (
          <Table headers={["Purchase", "Commission", "Status", "Date", ""]}>
            {detail.commissions.map((c) => (
              <tr key={c.id} className="bg-white dark:bg-zinc-900">
                <td className="px-4 py-2.5 tabular-nums text-zinc-600 dark:text-zinc-400">{usd(c.amount_usd)}</td>
                <td className="px-4 py-2.5 tabular-nums font-medium text-zinc-900 dark:text-white">{usd(c.commission_usd)}</td>
                <td className="px-4 py-2.5"><StatusPill status={c.status} /></td>
                <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{new Date(c.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-2.5 text-right">
                  {c.status === "pending" && (
                    <button onClick={() => voidCommission(c.id)} disabled={busy}
                      className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 dark:bg-red-500/10 dark:text-red-400">
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* Referrals */}
      <Section title={`Referrals (${detail.referrals.length})`}>
        {detail.referrals.length === 0 ? <Empty /> : (
          <Table headers={["Email", "Source", "Status", "Signed up", "Earned"]}>
            {detail.referrals.map((r) => (
              <tr key={r.id} className="bg-white dark:bg-zinc-900">
                <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">{r.email ?? "—"}</td>
                <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{r.source === "email_match" ? "Email" : "Link"}</td>
                <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{r.first_purchase_at ? "Paying" : "Signed up"}</td>
                <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{new Date(r.referred_at).toLocaleDateString()}</td>
                <td className="px-4 py-2.5 tabular-nums text-zinc-700 dark:text-zinc-300">{usd(r.earned_usd)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {/* Payouts */}
      <Section title={`Payouts (${detail.payouts.length})`}>
        {detail.payouts.length === 0 ? <Empty /> : (
          <Table headers={["Amount", "Method", "Reference", "Status", "Date"]}>
            {detail.payouts.map((p) => (
              <tr key={p.id} className="bg-white dark:bg-zinc-900">
                <td className="px-4 py-2.5 tabular-nums text-zinc-700 dark:text-zinc-300">{usd(p.amount_usd)}</td>
                <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{p.method ?? "—"}</td>
                <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{p.reference ?? "—"}</td>
                <td className="px-4 py-2.5"><StatusPill status={p.status} /></td>
                <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{new Date(p.paid_at ?? p.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">{title}</h2>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing here yet.</p>;
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-400 dark:bg-zinc-900">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-2.5 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{children}</tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "paid"
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
      : status === "voided"
        ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
        : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}
