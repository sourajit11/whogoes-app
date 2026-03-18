"use client";

import { useState } from "react";
import Link from "next/link";
import StatCard from "../components/stat-card";
import EmptyState from "../components/empty-state";

interface Payment {
  id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  amount_usd: number;
  currency: string;
  credits: number;
  package_name: string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
}

interface UsageEntry {
  event_id: string;
  event_name: string;
  credits_used: number;
  unlocked_at: string;
}

type Tab = "payments" | "usage";

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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

function PackageName({ name }: { name: string | null }) {
  if (!name) return <span className="text-zinc-400">—</span>;
  return <span className="font-medium capitalize">{name}</span>;
}

function openInvoice(payment: Payment, userEmail: string) {
  const w = window.open("", "_blank");
  if (!w) return;

  const invoiceNumber = payment.razorpay_payment_id || payment.razorpay_order_id;
  const paidDate = payment.paid_at ? formatDate(payment.paid_at) : formatDate(payment.created_at);

  w.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Invoice - ${invoiceNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #18181b; padding: 48px; max-width: 720px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 48px; }
    .logo { display: flex; align-items: center; gap: 10px; }
    .logo-box { width: 32px; height: 32px; background: #10b981; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 14px; }
    .logo-text { font-size: 20px; font-weight: 700; }
    .invoice-label { text-align: right; }
    .invoice-label h2 { font-size: 24px; font-weight: 700; color: #10b981; }
    .invoice-label p { font-size: 13px; color: #71717a; margin-top: 4px; }
    .section { margin-bottom: 32px; }
    .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1aa; margin-bottom: 8px; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
    .detail-row + .detail-row { border-top: 1px solid #f4f4f5; }
    .detail-label { color: #71717a; }
    .detail-value { font-weight: 500; }
    .table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .table th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1aa; padding: 10px 12px; border-bottom: 2px solid #e4e4e7; }
    .table td { padding: 12px; font-size: 14px; border-bottom: 1px solid #f4f4f5; }
    .table .right { text-align: right; }
    .total-row td { font-weight: 700; font-size: 16px; border-top: 2px solid #18181b; border-bottom: none; }
    .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid #e4e4e7; font-size: 12px; color: #a1a1aa; text-align: center; }
    .badge { display: inline-block; background: #ecfdf5; color: #059669; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    @media print { body { padding: 24px; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">
      <div class="logo-box">W</div>
      <span class="logo-text">WhoGoes</span>
    </div>
    <div class="invoice-label">
      <h2>INVOICE</h2>
      <p>${invoiceNumber}</p>
    </div>
  </div>

  <div class="section">
    <p class="section-title">Bill To</p>
    <div class="detail-row">
      <span class="detail-label">Email</span>
      <span class="detail-value">${userEmail}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Date</span>
      <span class="detail-value">${paidDate}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Status</span>
      <span class="detail-value"><span class="badge">${payment.status.toUpperCase()}</span></span>
    </div>
  </div>

  <div class="section">
    <p class="section-title">Order Details</p>
    <table class="table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Credits</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${payment.package_name ? payment.package_name.charAt(0).toUpperCase() + payment.package_name.slice(1) + " Plan" : "Credit Package"}</td>
          <td>${payment.credits.toLocaleString()}</td>
          <td class="right">$${Number(payment.amount_usd).toFixed(2)}</td>
        </tr>
        <tr class="total-row">
          <td colspan="2">Total</td>
          <td class="right">$${Number(payment.amount_usd).toFixed(2)} ${payment.currency}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="footer">
    <p style="font-weight: 600; font-size: 13px; color: #18181b;">AVRPIX SOLUTIONS PRIVATE LIMITED</p>
    <p style="margin-top: 4px;">S NO 635/1A, PLOT NO-20, VAIBHAV SOCIETY, Bibvewadi, Pune City, Pune- 411037, Maharashtra, India</p>
    <p style="margin-top: 2px;">GST: 27ABBCA4226B1Z9</p>
    <p style="margin-top: 8px;">WhoGoes &middot; Trade Show &amp; Event Attendee Data &middot; hello@whogoes.co</p>
    <p style="margin-top: 4px;">Thank you for your purchase!</p>
  </div>

  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`);
  w.document.close();
}

export default function BillingContent({
  payments,
  usage,
  userEmail,
}: {
  payments: Payment[];
  usage: UsageEntry[];
  userEmail: string;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("payments");

  const paidPayments = payments.filter((p) => p.status === "paid");
  const totalSpent = paidPayments.reduce((sum, p) => sum + Number(p.amount_usd), 0);
  const totalCreditsPurchased = paidPayments.reduce((sum, p) => sum + p.credits, 0);
  const totalCreditsUsed = usage.reduce((sum, u) => sum + Number(u.credits_used), 0);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Billing
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Payment history, credit usage, and invoices
      </p>

      {/* Tabs */}
      <div className="mt-6 flex items-center gap-2">
        {(["payments", "usage"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-zinc-900 text-white dark:bg-zinc-700"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            }`}
          >
            {tab === "payments" ? "Payments" : "Credit Usage"}{" "}
            <span className="ml-1 text-xs opacity-60">
              ({tab === "payments" ? payments.length : usage.length})
            </span>
          </button>
        ))}
      </div>

      {/* Payments Tab */}
      {activeTab === "payments" && (
        <div className="mt-6 space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard
              label="Total Spent"
              value={`$${totalSpent.toFixed(2)}`}
              accent="emerald"
            />
            <StatCard
              label="Credits Purchased"
              value={totalCreditsPurchased}
              accent="blue"
            />
            <StatCard
              label="Transactions"
              value={payments.length}
            />
          </div>

          {/* Table */}
          {payments.length === 0 ? (
            <EmptyState
              icon={
                <svg
                  className="h-6 w-6 text-zinc-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                  />
                </svg>
              }
              title="No payments yet"
              description="Purchase credits to unlock event contact data."
            >
              <button
                onClick={() =>
                  window.dispatchEvent(new CustomEvent("open-buy-credits"))
                }
                className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
              >
                Buy Credits
              </button>
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                        Date
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
                        Invoice
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                    {payments.map((payment) => (
                      <tr
                        key={payment.id}
                        className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                      >
                        <td className="whitespace-nowrap px-4 py-3.5 text-zinc-500">
                          {formatDateTime(payment.created_at)}
                        </td>
                        <td className="px-4 py-3.5 text-zinc-900 dark:text-zinc-100">
                          <PackageName name={payment.package_name} />
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
                              onClick={() => openInvoice(payment, userEmail)}
                              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
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
                            <span className="text-xs text-zinc-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Usage Tab */}
      {activeTab === "usage" && (
        <div className="mt-6 space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Credits Used"
              value={totalCreditsUsed}
              accent="indigo"
            />
            <StatCard
              label="Events Accessed"
              value={usage.length}
              accent="blue"
            />
          </div>

          {/* Table */}
          {usage.length === 0 ? (
            <EmptyState
              icon={
                <svg
                  className="h-6 w-6 text-zinc-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              }
              title="No credit usage yet"
              description="Unlock event contacts to see your usage history here."
            >
              <Link
                href="/dashboard/events"
                className="mt-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
              >
                Browse Events
              </Link>
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                        Date
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                        Event
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                        Credits Used
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
                    {usage.map((entry) => (
                      <tr
                        key={entry.event_id}
                        className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                      >
                        <td className="whitespace-nowrap px-4 py-3.5 text-zinc-500">
                          {formatDate(entry.unlocked_at)}
                        </td>
                        <td className="px-4 py-3.5">
                          <Link
                            href={`/dashboard/events/${entry.event_id}`}
                            className="font-medium text-zinc-900 hover:text-emerald-600 dark:text-zinc-100 dark:hover:text-emerald-400"
                          >
                            {entry.event_name}
                          </Link>
                        </td>
                        <td className="px-4 py-3.5 tabular-nums text-zinc-900 dark:text-zinc-100">
                          {Number(entry.credits_used).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
