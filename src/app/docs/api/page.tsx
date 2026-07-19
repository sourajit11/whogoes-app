import type { Metadata } from "next";
import ApiDocs from "./api-docs";

export const metadata: Metadata = {
  title: "WhoGoes Public API Documentation",
  description:
    "REST API for programmatic access to WhoGoes attendee contact data: ICP filters, unlocks with verified emails, incremental sync, idempotency, rate limits, and examples.",
};

// Content is compiled in (see api-docs.tsx, kept in sync with docs/API.md).
export default function ApiDocsPage() {
  return <ApiDocs />;
}
