import type { MDXComponents } from "mdx/types";
import Link from "next/link";
import { ComparisonTable } from "./comparison-table";

export const mdxComponents: MDXComponents = {
  h1: (props) => (
    <h1
      className="text-3xl font-bold text-zinc-900 dark:text-white mt-8 mb-4"
      {...props}
    />
  ),
  h2: (props) => (
    <h2
      className="text-2xl font-semibold text-zinc-900 dark:text-white mt-8 mb-3"
      {...props}
    />
  ),
  h3: (props) => (
    <h3
      className="text-xl font-semibold text-zinc-800 dark:text-zinc-100 mt-6 mb-2"
      {...props}
    />
  ),
  p: (props) => (
    <p
      className="text-base leading-7 text-zinc-700 dark:text-zinc-300 mb-4"
      {...props}
    />
  ),
  a: (props) => (
    <a
      className="text-emerald-600 hover:text-emerald-500 underline underline-offset-2"
      {...props}
    />
  ),
  ul: (props) => (
    <ul
      className="list-disc pl-6 mb-4 text-zinc-700 dark:text-zinc-300 space-y-1"
      {...props}
    />
  ),
  ol: (props) => (
    <ol
      className="list-decimal pl-6 mb-4 text-zinc-700 dark:text-zinc-300 space-y-1"
      {...props}
    />
  ),
  li: (props) => <li className="text-base leading-7" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="border-l-4 border-emerald-500 pl-4 italic text-zinc-600 dark:text-zinc-400 my-4"
      {...props}
    />
  ),
  code: (props) => (
    <code
      className="rounded bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-sm font-mono"
      {...props}
    />
  ),
  pre: (props) => (
    <pre
      className="rounded-lg bg-zinc-900 dark:bg-zinc-800 p-4 overflow-x-auto text-sm text-zinc-100 mb-4"
      {...props}
    />
  ),
  hr: () => <hr className="border-zinc-200 dark:border-zinc-800 my-8" />,
  table: (props) => (
    <div className="overflow-x-auto mb-4">
      <table
        className="w-full text-sm border-collapse border border-zinc-200 dark:border-zinc-700"
        {...props}
      />
    </div>
  ),
  th: (props) => (
    <th
      className="border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-3 py-2 text-left font-semibold text-zinc-900 dark:text-white"
      {...props}
    />
  ),
  td: (props) => (
    <td
      className="border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-700 dark:text-zinc-300"
      {...props}
    />
  ),
  strong: (props) => (
    <strong
      className="font-semibold text-zinc-900 dark:text-white"
      {...props}
    />
  ),
  // Custom components usable inside MDX files
  Callout: ({
    children,
    type = "info",
  }: {
    children: React.ReactNode;
    type?: "info" | "warning" | "tip";
  }) => {
    const styles = {
      info: "bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800",
      warning:
        "bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800",
      tip: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-800",
    };
    return (
      <div className={`rounded-lg border p-4 mb-4 ${styles[type]}`}>
        {children}
      </div>
    );
  },
  ComparisonTable: ComparisonTable as unknown as React.ComponentType,
  CTA: () => (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950 dark:border-emerald-800 p-6 my-8 text-center">
      <p className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
        Ready to get your attendee list?
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
        Browse 1,200+ trade shows. 5 free preview contacts per event.
      </p>
      <Link
        href="/events"
        className="inline-block rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
      >
        Browse Events Free
      </Link>
    </div>
  ),
};
