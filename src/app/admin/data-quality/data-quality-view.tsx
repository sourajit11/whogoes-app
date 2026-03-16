"use client";

import { useMemo } from "react";
import Link from "next/link";
import StatCard from "@/app/dashboard/components/stat-card";
import type { AdminDataQuality } from "@/types/admin";

interface DataQualityViewProps {
  data: AdminDataQuality[];
}

function QualityCell({ rate }: { rate: number }) {
  const color =
    rate >= 80
      ? "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10"
      : rate >= 50
        ? "text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/10"
        : "text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-500/10";

  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${color}`}>
      {rate}%
    </span>
  );
}

export default function DataQualityView({ data }: DataQualityViewProps) {
  const averages = useMemo(() => {
    if (data.length === 0) {
      return { email: 0, linkedin: 0, company: 0, title: 0, postUrl: 0, totalContacts: 0 };
    }
    const totalContacts = data.reduce((s, d) => s + d.total_contacts, 0);
    const totalEmail = data.reduce((s, d) => s + d.with_email, 0);
    const totalLinkedIn = data.reduce((s, d) => s + d.with_linkedin, 0);
    const totalCompany = data.reduce((s, d) => s + d.with_company, 0);
    const totalTitle = data.reduce((s, d) => s + d.with_title, 0);
    const totalPostUrl = data.reduce((s, d) => s + d.with_post_url, 0);
    return {
      email: totalContacts > 0 ? Math.round((100 * totalEmail) / totalContacts) : 0,
      linkedin: totalContacts > 0 ? Math.round((100 * totalLinkedIn) / totalContacts) : 0,
      company: totalContacts > 0 ? Math.round((100 * totalCompany) / totalContacts) : 0,
      title: totalContacts > 0 ? Math.round((100 * totalTitle) / totalContacts) : 0,
      postUrl: totalContacts > 0 ? Math.round((100 * totalPostUrl) / totalContacts) : 0,
      totalContacts,
    };
  }, [data]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        Data Quality
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Contact data completeness across {data.length} events
      </p>

      {/* Overall Averages */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total Contacts" value={averages.totalContacts} />
        <StatCard label="Avg Email %" value={`${averages.email}%`} accent={averages.email >= 80 ? "emerald" : undefined} />
        <StatCard label="Avg LinkedIn %" value={`${averages.linkedin}%`} accent={averages.linkedin >= 80 ? "emerald" : undefined} />
        <StatCard label="Avg Company %" value={`${averages.company}%`} accent={averages.company >= 80 ? "emerald" : undefined} />
        <StatCard label="Avg Title %" value={`${averages.title}%`} accent={averages.title >= 80 ? "emerald" : undefined} />
        <StatCard label="Avg Post URL %" value={`${averages.postUrl}%`} accent={averages.postUrl >= 80 ? "emerald" : undefined} />
      </div>

      {/* Table */}
      <div className="mt-8 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Event
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Contacts
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Email
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                LinkedIn
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Company
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Title
              </th>
              <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Post URL
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
            {data.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-zinc-400">
                  No data yet
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const companyRate = row.total_contacts > 0 ? Math.round((100 * row.with_company) / row.total_contacts) : 0;
                const titleRate = row.total_contacts > 0 ? Math.round((100 * row.with_title) / row.total_contacts) : 0;
                const postUrlRate = row.total_contacts > 0 ? Math.round((100 * row.with_post_url) / row.total_contacts) : 0;

                return (
                  <tr
                    key={row.event_id}
                    className="transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30"
                  >
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/admin/events/${row.event_id}`}
                        className="font-medium text-zinc-900 hover:text-indigo-600 dark:text-zinc-100 dark:hover:text-indigo-400"
                      >
                        {row.event_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 tabular-nums text-zinc-500">
                      {row.total_contacts.toLocaleString()}
                    </td>
                    <td className="px-4 py-3.5">
                      <QualityCell rate={row.email_rate ?? 0} />
                    </td>
                    <td className="px-4 py-3.5">
                      <QualityCell rate={row.linkedin_rate ?? 0} />
                    </td>
                    <td className="px-4 py-3.5">
                      <QualityCell rate={companyRate} />
                    </td>
                    <td className="px-4 py-3.5">
                      <QualityCell rate={titleRate} />
                    </td>
                    <td className="px-4 py-3.5">
                      <QualityCell rate={postUrlRate} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
