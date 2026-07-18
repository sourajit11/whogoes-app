import fs from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { mdxComponents } from "@/components/mdx-components";

export const metadata: Metadata = {
  title: "WhoGoes Public API Documentation",
  description:
    "REST API for programmatic access to WhoGoes attendee contact data: ICP filters, unlocks with verified emails, auto-pull, idempotency, rate limits, and examples.",
};

export const revalidate = 3600;

async function loadDocs(): Promise<string> {
  const filePath = path.join(process.cwd(), "docs", "API.md");
  return fs.readFile(filePath, "utf8");
}

export default async function ApiDocsPage() {
  const source = await loadDocs();

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="prose prose-zinc dark:prose-invert max-w-none">
        <MDXRemote
          source={source}
          components={mdxComponents}
          options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
        />
      </div>
    </main>
  );
}
