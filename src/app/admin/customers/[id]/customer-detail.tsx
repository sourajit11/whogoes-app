"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import StatCard from "@/app/dashboard/components/stat-card";
import type {
  AdminCustomerSubscription,
  AdminCustomerUnlock,
  AdminPayment,
} from "@/types/admin";

type PaymentPeriod = "all" | "month" | "quarter" | "year";

interface CustomerDetailProps {
  userId: string;
  email: string;
  signedUpAt: string;
  freeCredits: number;
  paidCredits: number;
  totalPaidAmount: number;
  totalPurchasedCredits: number;
  payments: AdminPayment[];
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
  totalPaidAmount,
  totalPurchasedCredits,
  payments,
  subscriptions,
  recentUnlocks,
  monthlyBreakdown,
}: CustomerDetailProps) {
  const router = useRouter();
  const totalBalance = freeCredits + paidCredits;

  // Add Credits state
  const [creditsToAdd, setCreditsToAdd] = useState(0);
  const [isAdding, setIsAdding] = useState(false);
  const [addMessage, setAddMessage] = useState("");

  // Payment history filter
  const [paymentPeriod, setPaymentPeriod] = useState<PaymentPeriod>("all");

  const filteredPayments = useMemo(() => {
    if (paymentPeriod === "all") return payments;
    const now = new Date();
    let cutoff: Date;
    switch (paymentPeriod) {
      case "month":
        cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "quarter":
        cutoff = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        break;
      case "year":
        cutoff = new Date(now.getFullYear(), 0, 1);
        break;
    }
    return payments.filter(
      (p) => new Date(p.created_at) >= cutoff
    );
  }, [payments, paymentPeriod]);

  async function handleAddCredits() {
    if (creditsToAdd <= 0) return;
    setIsAdding(true);
    setAddMessage("");
    try {
      const res = await fetch("/admin/api/add-credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          credits_to_add: creditsToAdd,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setAddMessage(
          `Added ${creditsToAdd} credits. New balance: ${data.new_balance}`
        );
        setCreditsToAdd(0);
        setTimeout(() => {
          setAddMessage("");
          router.refresh();
        }, 1500);
      } else {
        setAddMessage(data.message || "Failed to add credits");
      }
    } catch {
      setAddMessage("Error adding credits");
    } finally {
      setIsAdding(false);
    }
  }

  function statusBadge(status: string) {
    const styles: Record<string, string> = {
      paid: "bg-emerald-50 text-emerald-700 ring-emerald-600/10 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20",
      failed:
        "bg-red-50 text-red-700 ring-red-600/10 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20",
      created:
        "bg-zinc-100 text-zinc-600 ring-zinc-500/10 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-500/20",
    };
    return (
      <span
        className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${styles[status] ?? styles.created}`}
      >
        {status}
      </span>
    );
  }

  function formatPackage(pkg: string | null) {
    if (!pkg) return "-";
    const colors: Record<string, string> = {
      starter:
        "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
      growth:
        "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
      pro: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400",
    };
    return (
      <span
        className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium capitalize ${colors[pkg] ?? colors.starter}`}
      >
        {pkg}
      </span>
    );
  }

  const periodPillClass = (active: boolean) =>
    `cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
      active
        ? "bg-indigo-50 text-indigo-700 dark:bg-zinc-700 dark:text-white"
        : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
    }`;

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

      {/* Stats — 5 columns */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Total Credits" value={totalBalance} accent="indigo" />
        <StatCard label="Free Credits" value={freeCredits} />
        <StatCard label="Paid Credits" value={paidCredits} accent="emerald" />
        <StatCard
          label="Total Paid"
          value={`$${Number(totalPaidAmount).toFixed(0)}`}
          accent="emerald"
        />
        <StatCard
          label="Contacts Unlocked"
          value={recentUnlocks.length}
        />
      </div>

      {/* Add Credits */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Add Credits
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          Grant additional credits to this user. Free trial credits (
          {freeCredits} remaining) are managed separately.
        </p>
        <div className="mt-3 flex items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-500">
              Credits to Add
            </label>
            <input
              type="number"
              min={1}
              value={creditsToAdd || ""}
              onChange={(e) => setCreditsToAdd(parseInt(e.target.value) || 0)}
              placeholder="e.g. 100"
              className="mt-1 w-32 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <button
            onClick={handleAddCredits}
            disabled={isAdding || creditsToAdd <= 0}
            className="cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAdding ? "Adding..." : "Add Credits"}
          </button>
          {addMessage && (
            <span className="text-sm text-zinc-500">{addMessage}</span>
          )}
        </div>
      </div>

      {/* Payment History */}
      {payments.length > 0 && (
        <div className="mt-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Payment History ({filteredPayments.length})
            </h2>
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/50">
              {(
                [
                  ["all", "All"],
                  ["month", "This Month"],
                  ["quarter", "This Quarter"],
                  ["year", "This Year"],
                ] as [PaymentPeriod, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setPaymentPeriod(key)}
                  className={periodPillClass(paymentPeriod === key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Date
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Credits
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Package
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-6 text-center text-sm text-zinc-400"
                    >
                      No payments in this period
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((p) => (
                    <tr
                      key={p.id}
                      className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                    >
                      <td className="px-4 py-3 text-zinc-500">
                        {new Date(
                          p.paid_at ?? p.created_at
                        ).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
                        ${Number(p.amount_usd).toFixed(0)}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-zinc-500">
                        {p.credits.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {formatPackage(p.package_name)}
                      </td>
                      <td className="px-4 py-3">{statusBadge(p.status)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
                    <td
                      colSpan={3}
                      className="px-4 py-6 text-center text-sm text-zinc-400"
                    >
                      No subscriptions
                    </td>
                  </tr>
                ) : (
                  subscriptions.map((sub) => (
                    <tr
                      key={sub.event_id}
                      className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                    >
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
                    <td
                      colSpan={2}
                      className="px-4 py-6 text-center text-sm text-zinc-400"
                    >
                      No usage yet
                    </td>
                  </tr>
                ) : (
                  monthlyBreakdown.map((row) => (
                    <tr
                      key={row.month}
                      className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                    >
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
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-sm text-zinc-400"
                  >
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
