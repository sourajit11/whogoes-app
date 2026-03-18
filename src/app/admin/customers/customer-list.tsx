"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AdminCustomer } from "@/types/admin";

interface CustomerListProps {
  customers: AdminCustomer[];
}

type CustomerTab = "paid" | "free";
type SortKey = keyof AdminCustomer;
type SortDir = "asc" | "desc";

export default function CustomerList({ customers }: CustomerListProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<CustomerTab>("paid");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("total_paid_amount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Add Credits modal state
  const [addCreditsTarget, setAddCreditsTarget] = useState<{
    userId: string;
    email: string;
  } | null>(null);
  const [creditsToAdd, setCreditsToAdd] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState("");

  const paidCustomers = useMemo(
    () => customers.filter((c) => c.total_paid_amount > 0),
    [customers]
  );
  const freeCustomers = useMemo(
    () => customers.filter((c) => c.total_paid_amount === 0),
    [customers]
  );

  const activeList = activeTab === "paid" ? paidCustomers : freeCustomers;

  const filtered = useMemo(() => {
    let result = activeList;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.email.toLowerCase().includes(q));
    }
    result = [...result].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDir === "asc"
        ? Number(aVal) - Number(bVal)
        : Number(bVal) - Number(aVal);
    });
    return result;
  }, [activeList, search, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function handleTabChange(tab: CustomerTab) {
    setActiveTab(tab);
    setSearch("");
    if (tab === "paid") {
      setSortKey("total_paid_amount");
      setSortDir("desc");
    } else {
      setSortKey("signed_up_at");
      setSortDir("desc");
    }
  }

  async function handleAddCredits() {
    if (!addCreditsTarget || creditsToAdd <= 0) return;
    setIsSubmitting(true);
    setResultMessage("");
    try {
      const res = await fetch("/admin/api/add-credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: addCreditsTarget.userId,
          credits_to_add: creditsToAdd,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResultMessage(
          `Added ${creditsToAdd} credits. New balance: ${data.new_balance}`
        );
        setTimeout(() => {
          setAddCreditsTarget(null);
          setCreditsToAdd(0);
          setResultMessage("");
          router.refresh();
        }, 1500);
      } else {
        setResultMessage(data.message || "Failed to add credits");
      }
    } catch {
      setResultMessage("Error adding credits");
    } finally {
      setIsSubmitting(false);
    }
  }

  function SortIndicator({ column }: { column: SortKey }) {
    if (sortKey !== column) return null;
    return <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
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

  const thClass =
    "cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300";

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Customers
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        {customers.length} total users
      </p>

      {/* Tabs + Search */}
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {(["paid", "free"] as CustomerTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "bg-zinc-900 text-white dark:bg-zinc-700"
                  : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {tab === "paid" ? "Paid Customers" : "Free Signups"}
              <span className="ml-1.5 text-xs opacity-60">
                ({tab === "paid" ? paidCustomers.length : freeCustomers.length})
              </span>
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search by email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
        />
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
              <th className={thClass} onClick={() => handleSort("email")}>
                Email <SortIndicator column="email" />
              </th>
              {activeTab === "paid" ? (
                <>
                  <th
                    className={thClass}
                    onClick={() => handleSort("total_paid_amount")}
                  >
                    Total Paid{" "}
                    <SortIndicator column="total_paid_amount" />
                  </th>
                  <th
                    className={thClass}
                    onClick={() => handleSort("credit_balance")}
                  >
                    Balance <SortIndicator column="credit_balance" />
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Package
                  </th>
                  <th
                    className={thClass}
                    onClick={() => handleSort("contacts_unlocked")}
                  >
                    Unlocked{" "}
                    <SortIndicator column="contacts_unlocked" />
                  </th>
                  <th
                    className={thClass}
                    onClick={() => handleSort("last_payment_at")}
                  >
                    Last Payment{" "}
                    <SortIndicator column="last_payment_at" />
                  </th>
                </>
              ) : (
                <>
                  <th
                    className={thClass}
                    onClick={() => handleSort("free_credits")}
                  >
                    Free Credits{" "}
                    <SortIndicator column="free_credits" />
                  </th>
                  <th
                    className={thClass}
                    onClick={() => handleSort("contacts_unlocked")}
                  >
                    Unlocked{" "}
                    <SortIndicator column="contacts_unlocked" />
                  </th>
                  <th
                    className={thClass}
                    onClick={() => handleSort("signed_up_at")}
                  >
                    Signed Up{" "}
                    <SortIndicator column="signed_up_at" />
                  </th>
                  <th
                    className={thClass}
                    onClick={() => handleSort("last_activity")}
                  >
                    Last Activity{" "}
                    <SortIndicator column="last_activity" />
                  </th>
                </>
              )}
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={activeTab === "paid" ? 7 : 6}
                  className="px-4 py-8 text-center text-sm text-zinc-400"
                >
                  {search
                    ? "No customers match your search"
                    : activeTab === "paid"
                      ? "No paid customers yet"
                      : "No free signups"}
                </td>
              </tr>
            ) : (
              filtered.map((customer) => (
                <tr
                  key={customer.user_id}
                  className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                >
                  <td className="px-4 py-3.5">
                    <Link
                      href={`/admin/customers/${customer.user_id}`}
                      className="font-medium text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
                    >
                      {customer.email}
                    </Link>
                  </td>
                  {activeTab === "paid" ? (
                    <>
                      <td className="px-4 py-3.5 tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                        ${Number(customer.total_paid_amount).toFixed(0)}
                      </td>
                      <td className="px-4 py-3.5 tabular-nums text-zinc-500">
                        {customer.credit_balance}
                      </td>
                      <td className="px-4 py-3.5">
                        {formatPackage(customer.last_package)}
                      </td>
                      <td className="px-4 py-3.5 tabular-nums text-zinc-500">
                        {customer.contacts_unlocked.toLocaleString()}
                      </td>
                      <td className="px-4 py-3.5 text-zinc-400">
                        {customer.last_payment_at
                          ? new Date(
                              customer.last_payment_at
                            ).toLocaleDateString()
                          : "-"}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3.5 tabular-nums text-zinc-500">
                        {customer.free_credits}
                      </td>
                      <td className="px-4 py-3.5 tabular-nums text-zinc-500">
                        {customer.contacts_unlocked.toLocaleString()}
                      </td>
                      <td className="px-4 py-3.5 text-zinc-500">
                        {new Date(
                          customer.signed_up_at
                        ).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3.5 text-zinc-400">
                        {customer.last_activity
                          ? new Date(
                              customer.last_activity
                            ).toLocaleDateString()
                          : "Never"}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-3.5">
                    <button
                      onClick={() =>
                        setAddCreditsTarget({
                          userId: customer.user_id,
                          email: customer.email,
                        })
                      }
                      className="cursor-pointer rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20"
                    >
                      + Add
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add Credits Modal */}
      {addCreditsTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Add Credits
            </h3>
            <p className="mt-1 text-sm text-zinc-400">
              {addCreditsTarget.email}
            </p>
            <div className="mt-4">
              <label className="block text-xs font-medium text-zinc-500">
                Credits to Add
              </label>
              <input
                type="number"
                min={1}
                value={creditsToAdd || ""}
                onChange={(e) =>
                  setCreditsToAdd(parseInt(e.target.value) || 0)
                }
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm tabular-nums text-zinc-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                autoFocus
                placeholder="e.g. 100"
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleAddCredits}
                disabled={isSubmitting || creditsToAdd <= 0}
                className="cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? "Adding..." : "Add Credits"}
              </button>
              <button
                onClick={() => {
                  setAddCreditsTarget(null);
                  setCreditsToAdd(0);
                  setResultMessage("");
                }}
                className="cursor-pointer rounded-lg px-4 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
            {resultMessage && (
              <p className="mt-3 text-sm text-zinc-500">{resultMessage}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
