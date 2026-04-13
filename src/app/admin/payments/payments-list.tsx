"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { AdminPaymentWithEmail } from "@/types/admin";
import KpiCard from "../components/kpi-card";
import { openInvoice } from "@/lib/utils/invoice";

interface PaymentsListProps {
  payments: AdminPaymentWithEmail[];
}

type StatusFilter = "all" | "paid" | "created" | "failed";

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "paid"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/10 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20"
      : status === "created"
        ? "bg-amber-50 text-amber-700 ring-amber-600/10 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20"
        : "bg-red-50 text-red-700 ring-red-600/10 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20";

  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export default function PaymentsList({ payments }: PaymentsListProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    let result = payments;

    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter);
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter((p) => p.user_email.toLowerCase().includes(q));
    }

    return result;
  }, [payments, statusFilter, search]);

  // KPI calculations from filtered data
  const paidPayments = filtered.filter((p) => p.status === "paid");
  const totalRevenue = paidPayments.reduce(
    (sum, p) => sum + Number(p.amount_usd),
    0
  );
  const totalCreditsSold = paidPayments.reduce(
    (sum, p) => sum + p.credits,
    0
  );

  const statusTabs: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "paid", label: "Paid" },
    { key: "created", label: "Pending" },
    { key: "failed", label: "Failed" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Payments
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          All customer payment receipts
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Total Revenue"
          value={totalRevenue.toFixed(2)}
          prefix="$"
          accent="emerald"
        />
        <KpiCard
          label="Total Transactions"
          value={filtered.length}
          accent="indigo"
        />
        <KpiCard
          label="Paid"
          value={paidPayments.length}
          accent="blue"
        />
        <KpiCard
          label="Credits Sold"
          value={totalCreditsSold.toLocaleString()}
          accent="amber"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1">
          {statusTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                statusFilter === tab.key
                  ? "bg-zinc-900 text-white dark:bg-zinc-700"
                  : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Search by email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500 sm:w-64"
        />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Date
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Customer
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Package
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Credits
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Amount
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Receipt
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-sm text-zinc-400"
                  >
                    No payments found
                  </td>
                </tr>
              ) : (
                filtered.map((payment) => (
                  <tr
                    key={payment.id}
                    className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                  >
                    <td className="whitespace-nowrap px-4 py-3.5 text-zinc-500">
                      {new Date(
                        payment.paid_at ?? payment.created_at
                      ).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/admin/customers/${payment.user_id}`}
                        className="font-medium text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
                      >
                        {payment.user_email}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-zinc-900 dark:text-zinc-100">
                      {payment.package_name ? (
                        <span className="font-medium capitalize">
                          {payment.package_name}
                        </span>
                      ) : (
                        <span className="text-zinc-400">&mdash;</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-zinc-900 dark:text-zinc-100">
                      {payment.credits.toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-zinc-900 dark:text-zinc-100">
                      ${Number(payment.amount_usd).toFixed(2)}
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusBadge status={payment.status} />
                    </td>
                    <td className="px-4 py-3.5">
                      {payment.status === "paid" ? (
                        <button
                          onClick={() =>
                            openInvoice(payment, payment.user_email)
                          }
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                        >
                          <svg
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                          </svg>
                          Download
                        </button>
                      ) : (
                        <span className="text-xs text-zinc-400">&mdash;</span>
                      )}
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
