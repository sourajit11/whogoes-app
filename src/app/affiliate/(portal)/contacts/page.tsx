"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AffiliateContact } from "../types";

export default function AffiliateContactsPage() {
  const supabase = createClient();
  const [raw, setRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [contacts, setContacts] = useState<AffiliateContact[]>([]);

  async function refresh() {
    const { data } = await supabase.rpc("affiliate_get_dashboard");
    if (data) setContacts((data.contacts ?? []) as AffiliateContact[]);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setResult(null);
    setLoading(true);

    // Accept emails separated by newlines, commas, or spaces.
    const emails = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes("@"));

    if (emails.length === 0) {
      setError("Add at least one valid email address.");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.rpc("affiliate_add_contacts", {
      p_emails: emails,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    if (data && !data.success) {
      setError(data.message || "Could not add contacts.");
      setLoading(false);
      return;
    }

    const parts = [`${data.added} added`];
    if (data.duplicates) parts.push(`${data.duplicates} already on your list`);
    if (data.matched) parts.push(`${data.matched} matched to a signup`);
    if (data.capped) parts.push("daily limit reached");
    setResult(parts.join(", ") + ".");
    setRaw("");
    setLoading(false);
    refresh();
  }

  const badge = (status: string) => {
    if (status === "matched") return "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400";
    if (status === "expired") return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500";
    return "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400";
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">Add Contacts</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Paste the emails of people you think will sign up. If an email registers within 7 days before or after you add it, the customer is credited to you.
      </p>

      <form onSubmit={handleSubmit} className="mt-6">
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={6}
          placeholder={"jane@company.com\njohn@business.com\n..."}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <p className="mt-1 text-xs text-zinc-400">Separate emails with new lines, commas, or spaces.</p>
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {result && <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">{result}</p>}
        <button type="submit" disabled={loading}
          className="mt-3 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
          {loading ? "Adding..." : "Add contacts"}
        </button>
      </form>

      <div className="mt-8">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">Your submitted contacts</h2>
        {contacts.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No contacts submitted yet.</p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wider text-zinc-400 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {contacts.map((c, i) => (
                  <tr key={i} className="bg-white dark:bg-zinc-900">
                    <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">{c.email}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge(c.status)}`}>{c.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500 dark:text-zinc-400">{new Date(c.added_at).toLocaleDateString()}</td>
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
