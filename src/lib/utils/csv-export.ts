import type { Contact } from "@/types";

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
    "Company LinkedIn",
    "Company Domain",
    "Company Website",
    "Company Industry",
    "Company Size",
    "Status",
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
    c.company_linkedin_url ?? "",
    c.company_domain ?? "",
    c.company_website ?? "",
    c.company_industry ?? "",
    c.company_size ?? "",
    c.is_downloaded ? "Processed" : "New",
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")
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
