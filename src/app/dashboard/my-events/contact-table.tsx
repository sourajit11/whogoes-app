"use client";

import { useState } from "react";
import type { Contact, SortKey, SortDir } from "@/types";

interface ContactTableProps {
  contacts: Contact[];
  startIndex?: number;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}

function formatPostDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

const SORTABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "full_name", label: "Name" },
  { key: "current_title", label: "Title" },
  { key: "company_name", label: "Company" },
  { key: "post_date", label: "Post Date" },
  { key: "email", label: "Email" },
];

// Total columns: #(1) + status(1) + Name + Title + PersonLI + Company + Source + PostDate + Location + CompanyDomain + CompanyLI + Industry + Size + Email = 14
const TOTAL_COLS = 14;

export default function ContactTable({ contacts, startIndex = 0, sortKey, sortDir, onSort }: ContactTableProps) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  if (contacts.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-zinc-200 bg-white text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        No contacts found
      </div>
    );
  }

  function SortableHeader({ col }: { col: { key: SortKey; label: string } }) {
    return (
      <th
        onClick={() => onSort(col.key)}
        className="cursor-pointer select-none whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <span className="inline-flex items-center gap-1">
          {col.label}
          {sortKey === col.key && (
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
              {sortDir === "asc" ? (
                <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" />
              ) : (
                <path d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z" />
              )}
            </svg>
          )}
        </span>
      </th>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/50">
              {/* Row number */}
              <th className="w-10 whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                #
              </th>
              {/* Status indicator */}
              <th className="w-8 px-2 py-3" />
              {/* Name — sortable */}
              <SortableHeader col={SORTABLE_COLUMNS[0]} />
              {/* Title — sortable */}
              <SortableHeader col={SORTABLE_COLUMNS[1]} />
              {/* Person LinkedIn — non-sortable */}
              <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Person LinkedIn
              </th>
              {/* Company — sortable */}
              <SortableHeader col={SORTABLE_COLUMNS[2]} />
              {/* Source */}
              <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Source
              </th>
              {/* Post Date — sortable */}
              <SortableHeader col={SORTABLE_COLUMNS[3]} />
              {/* Location */}
              <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Location
              </th>
              {/* Company Domain */}
              <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Company Domain
              </th>
              {/* Company LinkedIn */}
              <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Company LinkedIn
              </th>
              {/* Industry */}
              <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Industry
              </th>
              {/* Size */}
              <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Size
              </th>
              {/* Email — sortable */}
              <SortableHeader col={SORTABLE_COLUMNS[4]} />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/50">
            {contacts.map((contact, index) => (
              <TableRow
                key={contact.contact_id}
                contact={contact}
                rowNumber={startIndex + index + 1}
                isExpanded={expandedRow === contact.contact_id}
                totalCols={TOTAL_COLS}
                onToggle={() =>
                  setExpandedRow(
                    expandedRow === contact.contact_id
                      ? null
                      : contact.contact_id
                  )
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TableRow({
  contact,
  rowNumber,
  isExpanded,
  totalCols,
  onToggle,
}: {
  contact: Contact;
  rowNumber: number;
  isExpanded: boolean;
  totalCols: number;
  onToggle: () => void;
}) {
  const hasExtra =
    contact.headline ||
    contact.post_content;

  return (
    <>
      <tr
        onClick={hasExtra ? onToggle : undefined}
        className={`transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30 ${hasExtra ? "cursor-pointer" : ""}`}
      >
        {/* Row number */}
        <td className="whitespace-nowrap px-3 py-3.5 text-xs font-medium text-zinc-400 dark:text-zinc-500">
          {rowNumber}
        </td>

        {/* Status dot */}
        <td className="px-2 py-3.5">
          {!contact.is_downloaded ? (
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title="New" />
          ) : (
            <span className="inline-block h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" title="Processed" />
          )}
        </td>

        {/* Name */}
        <td className="whitespace-nowrap px-3 py-3.5">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {contact.full_name ?? "—"}
          </span>
        </td>

        {/* Title */}
        <td className="max-w-48 truncate px-3 py-3.5 text-zinc-500 dark:text-zinc-400">
          {contact.current_title ?? "—"}
        </td>

        {/* Person LinkedIn */}
        <td className="whitespace-nowrap px-3 py-3.5">
          {contact.contact_linkedin_url &&
          !contact.contact_linkedin_url.startsWith("placeholder") ? (
            <a
              href={contact.contact_linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex text-[#0A66C2] transition-opacity hover:opacity-70"
              title="Person LinkedIn"
            >
              <LinkedInIcon className="h-4 w-4" />
            </a>
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600">—</span>
          )}
        </td>

        {/* Company */}
        <td className="whitespace-nowrap px-3 py-3.5 text-zinc-500 dark:text-zinc-400">
          {contact.company_name ?? "—"}
        </td>

        {/* Source (LinkedIn post icon) */}
        <td className="px-3 py-3.5">
          {contact.post_url ? (
            <a
              href={contact.post_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex text-[#0A66C2] transition-opacity hover:opacity-70"
              title="View LinkedIn post"
            >
              <LinkedInIcon className="h-4 w-4" />
            </a>
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600">—</span>
          )}
        </td>

        {/* Post Date */}
        <td className="whitespace-nowrap px-3 py-3.5 text-zinc-400">
          {formatPostDate(contact.post_date)}
        </td>

        {/* Location */}
        <td className="whitespace-nowrap px-3 py-3.5 text-zinc-400">
          {[contact.city, contact.country].filter(Boolean).join(", ") || "—"}
        </td>

        {/* Company Domain */}
        <td className="whitespace-nowrap px-3 py-3.5">
          {contact.company_domain ? (
            <a
              href={`https://${contact.company_domain}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
            >
              {contact.company_domain}
            </a>
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600">—</span>
          )}
        </td>

        {/* Company LinkedIn */}
        <td className="whitespace-nowrap px-3 py-3.5">
          {contact.company_linkedin_url ? (
            <a
              href={contact.company_linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex text-[#0A66C2] transition-opacity hover:opacity-70"
              title="Company LinkedIn"
            >
              <LinkedInIcon className="h-4 w-4" />
            </a>
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600">—</span>
          )}
        </td>

        {/* Industry */}
        <td className="whitespace-nowrap px-3 py-3.5 text-zinc-500 dark:text-zinc-400">
          {contact.company_industry ?? "—"}
        </td>

        {/* Size */}
        <td className="whitespace-nowrap px-3 py-3.5 text-zinc-400">
          {contact.company_size ?? "—"}
        </td>

        {/* Email */}
        <td className="whitespace-nowrap px-3 py-3.5">
          {contact.email ? (
            <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">
              {contact.email}
            </span>
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600">—</span>
          )}
        </td>
      </tr>

      {isExpanded && hasExtra && (
        <tr>
          <td
            colSpan={totalCols}
            className="border-l-2 border-l-zinc-300 bg-zinc-50/50 px-6 py-5 dark:border-l-zinc-600 dark:bg-zinc-900/30"
          >
            <div className="space-y-4 text-sm">
              {contact.headline && (
                <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-3">
                  <DetailField label="Headline">{contact.headline}</DetailField>
                </div>
              )}

              {contact.post_content && (
                <div>
                  <SectionLabel>Post Content</SectionLabel>
                  <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap leading-relaxed text-zinc-500">
                    {contact.post_content}
                  </p>
                </div>
              )}

            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      <div className="mt-0.5 text-zinc-700 dark:text-zinc-300">{children}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
      {children}
    </p>
  );
}

