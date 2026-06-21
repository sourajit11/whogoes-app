"use client";

import { useState } from "react";
import type { Contact, SortKey, SortDir } from "@/types";

interface ContactTableProps {
  contacts: Contact[];
  startIndex?: number;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleAll?: (ids: string[]) => void;
  onRevealEmail?: (contactId: string) => void;
  revealingIds?: Set<string>;
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

// Event role -> badge styling. Attendee (the default/majority) is kept muted so the
// higher-intent roles (sponsor/exhibitor/organizer) stand out at a glance.
const ROLE_STYLES: Record<string, string> = {
  organizer:
    "bg-purple-50 text-purple-700 ring-purple-600/20 dark:bg-purple-500/10 dark:text-purple-300 dark:ring-purple-500/20",
  sponsor:
    "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20",
  exhibitor:
    "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20",
  attendee:
    "bg-zinc-100 text-zinc-500 ring-zinc-500/10 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700",
};

function RoleBadge({ role }: { role: string | null | undefined }) {
  const key = (role ?? "attendee").toLowerCase();
  const style = ROLE_STYLES[key] ?? ROLE_STYLES.attendee;
  const label = key.charAt(0).toUpperCase() + key.slice(1);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}>
      {label}
    </span>
  );
}

// Total columns: checkbox(1) + #(1) + status(1) + Name + Title + PersonLI + Company + Role + Source + PostDate + Location + Industry + Size + Email = 14
// (Company Domain / Company LinkedIn / Founded moved into the expand row to cut width.)
const TOTAL_COLS = 14;

export default function ContactTable({ contacts, startIndex = 0, sortKey, sortDir, onSort, selectedIds, onToggleSelect, onToggleAll, onRevealEmail, revealingIds }: ContactTableProps) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const allIds = contacts.map((c) => c.contact_id);
  const allSelected = allIds.length > 0 && selectedIds ? allIds.every((id) => selectedIds.has(id)) : false;

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
              {/* Checkbox */}
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onToggleAll?.(allIds)}
                  className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 dark:border-zinc-600"
                  title="Select all"
                />
              </th>
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
              {/* Event Role */}
              <th className="whitespace-nowrap px-3 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Role
              </th>
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
                isSelected={selectedIds?.has(contact.contact_id) ?? false}
                onToggleSelect={() => onToggleSelect?.(contact.contact_id)}
                onRevealEmail={onRevealEmail}
                isRevealing={revealingIds?.has(contact.contact_id) ?? false}
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
  isSelected,
  onToggleSelect,
  onRevealEmail,
  isRevealing,
  onToggle,
}: {
  contact: Contact;
  rowNumber: number;
  isExpanded: boolean;
  totalCols: number;
  isSelected: boolean;
  onToggleSelect: () => void;
  onRevealEmail?: (contactId: string) => void;
  isRevealing?: boolean;
  onToggle: () => void;
}) {
  // The expand row now holds the post plus the secondary company details that were
  // pulled out of the main table (domain / LinkedIn / website / founded / about).
  const hasExtra = !!(
    contact.post_content ||
    contact.company_linkedin_url ||
    contact.company_website ||
    contact.company_description ||
    contact.company_founded_year
  );

  return (
    <>
      <tr
        onClick={hasExtra ? onToggle : undefined}
        className={`transition-colors hover:bg-zinc-50/70 dark:hover:bg-zinc-900/30 ${hasExtra ? "cursor-pointer" : ""}`}
      >
        {/* Checkbox */}
        <td className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="h-3.5 w-3.5 cursor-pointer rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500 dark:border-zinc-600"
          />
        </td>

        {/* Row number + expand indicator */}
        <td className="whitespace-nowrap px-3 py-3.5 text-xs font-medium text-zinc-400 dark:text-zinc-500">
          <span className="inline-flex items-center gap-1">
            {rowNumber}
            {hasExtra && (
              <svg
                className={`h-3 w-3 text-zinc-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </span>
        </td>

        {/* Status dot */}
        <td className="px-2 py-3.5">
          {!contact.is_downloaded ? (
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" title="New" />
          ) : (
            <span className="inline-block h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" title="Processed" />
          )}
        </td>

        {/* Name (+ speaker mic when this contact spoke at the event) */}
        <td className="whitespace-nowrap px-3 py-3.5">
          <span className="inline-flex items-center gap-1.5">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {contact.full_name ?? "—"}
            </span>
            {contact.is_speaker && (
              <span title="Speaker" aria-label="Speaker" className="text-sm leading-none">
                🎤
              </span>
            )}
          </span>
        </td>

        {/* Title */}
        <td className="max-w-72 truncate px-3 py-3.5 text-zinc-500 dark:text-zinc-400">
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
        <td className="max-w-36 truncate px-3 py-3.5 text-zinc-500 dark:text-zinc-400">
          {contact.company_name ?? "—"}
        </td>

        {/* Event Role */}
        <td className="whitespace-nowrap px-3 py-3.5">
          <RoleBadge role={contact.event_role} />
        </td>

        {/* Source (View Post link) */}
        <td className="whitespace-nowrap px-3 py-3.5">
          {contact.post_url ? (
            <a
              href={contact.post_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-sm font-medium text-emerald-600 transition-colors hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300"
            >
              View Post
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

        {/* Industry — standardized bucket (falls back to legacy free-text) */}
        <td className="whitespace-nowrap px-3 py-3.5 text-zinc-500 dark:text-zinc-400">
          {contact.company_industry_bucket ?? contact.company_industry ?? "—"}
        </td>

        {/* Size — standardized employee-count bucket (falls back to legacy range) */}
        <td className="whitespace-nowrap px-3 py-3.5 text-zinc-400">
          {contact.company_size_bucket ?? contact.company_size ?? "—"}
        </td>

        {/* Email — revealed, locked (reveal for 1 credit), or none */}
        <td className="whitespace-nowrap px-3 py-3.5">
          {contact.email ? (
            <span className="font-mono text-xs text-zinc-800 dark:text-zinc-200">
              {contact.email}
            </span>
          ) : contact.has_email && contact.email_unlocked === false ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRevealEmail?.(contact.contact_id);
              }}
              disabled={isRevealing}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
              title="Reveal this verified email for 1 credit"
            >
              {isRevealing ? (
                "Revealing..."
              ) : (
                <>
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  Reveal · 1 cr
                </>
              )}
            </button>
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
              {/* Secondary company details, moved out of the main row to cut width.
                  (Company Domain dropped — redundant with Company Website.) */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <DetailField label="Company LinkedIn">
                  {contact.company_linkedin_url ? (
                    <a
                      href={contact.company_linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-[#0A66C2] hover:opacity-70"
                    >
                      <LinkedInIcon className="h-4 w-4" /> View
                    </a>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </DetailField>
                <DetailField label="Company Website">
                  {contact.company_website ? (
                    <a
                      href={contact.company_website.startsWith("http") ? contact.company_website : `https://${contact.company_website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {contact.company_website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </DetailField>
                <DetailField label="Founded">
                  {contact.company_founded_year ?? <span className="text-zinc-400">—</span>}
                </DetailField>
              </div>

              {contact.company_description && (
                <div>
                  <SectionLabel>About Company</SectionLabel>
                  <p className="mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap leading-relaxed text-zinc-500">
                    {contact.company_description}
                  </p>
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

