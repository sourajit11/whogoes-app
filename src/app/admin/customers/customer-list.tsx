"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { AdminCustomer } from "@/types/admin";

interface CustomerListProps {
  customers: AdminCustomer[];
}

type SortKey = keyof AdminCustomer;
type SortDir = "asc" | "desc";

export default function CustomerList({ customers }: CustomerListProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("signed_up_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    let result = customers;
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
  }, [customers, search, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIndicator({ column }: { column: SortKey }) {
    if (sortKey !== column) return null;
    return <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Customers
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        {customers.length} total users
      </p>

      {/* Search */}
      <div className="mt-6">
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
              <th
                className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                onClick={() => handleSort("email")}
              >
                Email <SortIndicator column="email" />
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                onClick={() => handleSort("signed_up_at")}
              >
                Signed Up <SortIndicator column="signed_up_at" />
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                onClick={() => handleSort("credit_balance")}
              >
                Credits <SortIndicator column="credit_balance" />
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                onClick={() => handleSort("contacts_unlocked")}
              >
                Unlocked <SortIndicator column="contacts_unlocked" />
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                onClick={() => handleSort("subscribed_events")}
              >
                Events <SortIndicator column="subscribed_events" />
              </th>
              <th
                className="cursor-pointer px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                onClick={() => handleSort("last_activity")}
              >
                Last Activity <SortIndicator column="last_activity" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-zinc-400">
                  {search ? "No customers match your search" : "No customers yet"}
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
                  <td className="px-4 py-3.5 text-zinc-500">
                    {new Date(customer.signed_up_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums text-zinc-500">
                    {customer.credit_balance}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums text-zinc-500">
                    {customer.contacts_unlocked.toLocaleString()}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums text-zinc-500">
                    {customer.subscribed_events}
                  </td>
                  <td className="px-4 py-3.5 text-zinc-400">
                    {customer.last_activity
                      ? new Date(customer.last_activity).toLocaleDateString()
                      : "Never"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
