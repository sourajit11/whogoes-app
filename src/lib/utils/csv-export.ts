import type { Contact } from "@/types";

// Collapse newlines/whitespace so every spreadsheet row renders at a uniform
// height. LinkedIn post content is multi-paragraph; raw newlines inside a quoted
// CSV cell make Excel/Sheets stretch that row to fit.
function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Excel silently parses bare numeric ranges like "1-10" or "11-50" as dates when a
// CSV is opened directly (1-10 shows up as 01-Oct). Wrapping the value in ="..."
// forces text; Excel, Google Sheets and Numbers all display it as the plain range.
function excelSafeRange(value: string): string {
  return /^\d+\s*-\s*\d+$/.test(value) ? `="${value}"` : value;
}

export function exportContactsCSV(contacts: Contact[], filename: string) {
  if (contacts.length === 0) return;

  const headers = [
    "Full Name",
    "First Name",
    "Last Name",
    "Title",
    "Company",
    "Email",
    "LinkedIn URL",
    "City",
    "Country",
    "Source",
    "Post URL",
    "Event Role",
    "Speaker",
    "Company LinkedIn",
    "Company Website",
    "Company Industry",
    "Company Size",
    "Post Content",
    "Status",
    "Notes",
  ];

  const rows = contacts.map((c) => [
    c.full_name ?? "",
    c.first_name ?? "",
    c.last_name ?? "",
    c.current_title ?? "",
    c.company_name ?? "",
    c.email ?? "",
    c.contact_linkedin_url ?? "",
    c.city ?? "",
    c.country ?? "",
    c.source ?? "",
    c.post_url ?? "",
    c.event_role === "expected_attendee"
      ? "Expected attendee"
      : (c.event_role ?? "attendee").replace(/^\w/, (m) => m.toUpperCase()),
    c.is_speaker ? "Yes" : "No",
    c.company_linkedin_url ?? "",
    c.company_website ?? "",
    // Same values the app table shows: the standardized bucket, falling back to
    // the legacy free-text only when the company hasn't been bucketed yet.
    c.company_industry_bucket ?? c.company_industry ?? "",
    excelSafeRange(c.company_size_bucket ?? c.company_size ?? ""),
    c.post_content ?? "",
    c.is_downloaded ? "Processed" : "New",
    c.lead_note ?? "",
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${singleLine(cell).replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
