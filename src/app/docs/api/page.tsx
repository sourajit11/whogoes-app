import fs from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Link from "next/link";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { mdxComponents } from "@/components/mdx-components";

export const metadata: Metadata = {
  title: "WhoGoes Public API Documentation",
  description:
    "REST API for programmatic access to WhoGoes attendee contact data: ICP filters, unlocks with verified emails, saved pull rules, idempotency, rate limits, and examples.",
};

export const revalidate = 3600;

async function loadDocs(): Promise<string> {
  const filePath = path.join(process.cwd(), "docs", "API.md");
  return fs.readFile(filePath, "utf8");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9\s/-]/g, "")
    .trim()
    .replace(/[\s/]+/g, "-");
}

function getText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return getText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

interface TocItem {
  level: 2 | 3;
  text: string;
  id: string;
}

// Build the section index from the markdown headings, skipping code fences
// (bash comments inside examples must not become index entries).
function buildToc(source: string): TocItem[] {
  const items: TocItem[] = [];
  let inFence = false;
  for (const line of source.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(##|###)\s+(.*)$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/`/g, "").trim();
    items.push({
      level: match[1].length === 2 ? 2 : 3,
      text,
      id: slugify(text),
    });
  }
  return items;
}

// Same heading styles as the shared MDX components, plus anchor ids so the
// index can link to them and scroll offset for the sticky header.
const docsComponents = {
  ...mdxComponents,
  h2: (props: ComponentPropsWithoutRef<"h2">) => (
    <h2
      id={slugify(getText(props.children))}
      className="scroll-mt-24 text-2xl font-semibold text-zinc-900 dark:text-white mt-12 mb-3"
      {...props}
    />
  ),
  h3: (props: ComponentPropsWithoutRef<"h3">) => (
    <h3
      id={slugify(getText(props.children))}
      className="scroll-mt-24 text-lg font-semibold text-zinc-800 dark:text-zinc-100 mt-8 mb-2 font-mono"
      {...props}
    />
  ),
};

function TocLinks({ items }: { items: TocItem[] }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.id} className={item.level === 3 ? "pl-3" : "pt-2"}>
          <a
            href={`#${item.id}`}
            className={
              item.level === 2
                ? "block text-sm font-medium text-zinc-800 hover:text-emerald-600 dark:text-zinc-200 dark:hover:text-emerald-400 transition-colors"
                : "block text-[13px] font-mono text-zinc-500 hover:text-emerald-600 dark:text-zinc-400 dark:hover:text-emerald-400 transition-colors truncate"
            }
          >
            {item.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default async function ApiDocsPage() {
  const source = await loadDocs();
  const toc = buildToc(source);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50/50 dark:bg-zinc-950">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <a href="https://whogoes.co" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500">
              <span className="text-sm font-bold text-white">W</span>
            </div>
            <span className="text-lg font-bold text-zinc-900 dark:text-white">
              WhoGoes
            </span>
            <span className="hidden lg:inline-block text-sm text-zinc-500 dark:text-zinc-400 border-l border-zinc-300 dark:border-zinc-700 pl-2.5 ml-0.5">
              Event Attendee Lists. With Proof.
            </span>
          </a>
          <nav className="flex items-center gap-3">
            <Link
              href="/events"
              className="hidden sm:inline text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors"
            >
              Events
            </Link>
            <Link
              href="/blog"
              className="hidden sm:inline text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors"
            >
              Blog
            </Link>
            <span className="hidden sm:inline text-sm font-medium text-zinc-900 dark:text-white">
              API Docs
            </span>
            <Link
              href="/login"
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              Start Free
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-10 px-6 py-10">
        <aside className="hidden lg:block w-72 shrink-0">
          <nav className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-4 pb-8">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-2">
              On this page
            </p>
            <TocLinks items={toc} />
            <div className="mt-8 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950">
              <p className="text-sm font-medium text-zinc-900 dark:text-white">
                Need a key?
              </p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Create API keys under Dashboard, then Integrations.
              </p>
              <Link
                href="/dashboard/integrations"
                className="mt-2 inline-block text-sm font-semibold text-emerald-700 hover:text-emerald-600 dark:text-emerald-400"
              >
                Open Integrations
              </Link>
            </div>
          </nav>
        </aside>

        <main className="min-w-0 max-w-3xl flex-1">
          <details className="lg:hidden mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-900 dark:text-white">
              On this page
            </summary>
            <div className="mt-3">
              <TocLinks items={toc} />
            </div>
          </details>

          <article>
            <MDXRemote
              source={source}
              components={docsComponents}
              options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
            />
          </article>

          <footer className="mt-16 border-t border-zinc-200 pt-6 pb-10 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            Questions? Email{" "}
            <a
              href="mailto:hello@whogoes.co"
              className="text-emerald-600 hover:text-emerald-500"
            >
              hello@whogoes.co
            </a>{" "}
            and we will help you get integrated.
          </footer>
        </main>
      </div>
    </div>
  );
}
