"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { exportContactsCSV } from "@/lib/utils/csv-export";
import type { Contact } from "@/types";

interface DownloadControlsProps {
  contacts: Contact[];
  eventName: string;
  eventId: string;
  activeTab: string;
  selectedContacts?: Contact[];
  onDownloaded?: (ids: string[]) => void;
  onClearSelection?: () => void;
}

export default function DownloadControls({
  contacts,
  eventName,
  eventId,
  activeTab,
  selectedContacts,
  onDownloaded,
  onClearSelection,
}: DownloadControlsProps) {
  const [downloading, setDownloading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const supabase = createClient();

  if (contacts.length === 0) return null;

  const newContacts = contacts.filter((c) => !c.is_downloaded);

  async function handleDownload(mode: "new" | "all" | "selected") {
    setDownloading(true);
    setMenuOpen(false);

    const toDownload =
      mode === "selected"
        ? (selectedContacts ?? [])
        : mode === "new"
          ? newContacts
          : contacts;
    if (toDownload.length === 0) {
      setDownloading(false);
      return;
    }

    const suffix =
      mode === "selected"
        ? "selected"
        : mode === "new"
          ? "new_leads"
          : "all_contacts";
    const filename = `${eventName}_${suffix}`;
    exportContactsCSV(toDownload, filename);

    // Mark downloaded contacts
    const undownloaded = toDownload
      .filter((c) => !c.is_downloaded)
      .map((c) => c.contact_id);

    if (undownloaded.length > 0) {
      await supabase.rpc("mark_contacts_downloaded", {
        p_event_id: eventId,
        p_contact_ids: undownloaded,
      });
    }

    // Update parent state instead of router.refresh()
    const allDownloadedIds = toDownload.map((c) => c.contact_id);
    onDownloaded?.(allDownloadedIds);

    if (mode === "selected") {
      onClearSelection?.();
    }

    setDownloading(false);
  }

  return (
    <div className="relative ml-auto">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        disabled={downloading}
        className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
      >
        {downloading ? (
          <>
            <svg
              className="h-4 w-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Downloading...
          </>
        ) : (
          <>
            <svg
              className="h-4 w-4"
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
            Download CSV
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
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </>
        )}
      </button>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {selectedContacts && selectedContacts.length > 0 && (
              <button
                onClick={() => handleDownload("selected")}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                Download Selected ({selectedContacts.length})
              </button>
            )}
            {newContacts.length > 0 && (
              <button
                onClick={() => handleDownload("new")}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Download New ({newContacts.length})
              </button>
            )}
            <button
              onClick={() => handleDownload("all")}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Download All ({contacts.length})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
