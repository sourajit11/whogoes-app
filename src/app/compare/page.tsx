import type { Metadata } from "next";
import Link from "next/link";
import { getAllComparisons } from "@/lib/compare";

export const metadata: Metadata = {
  title: "Compare WhoGoes — Trade Show Attendee List Alternatives",
  description:
    "See how WhoGoes compares to manual LinkedIn searching, event organizer lists, Bombora, 6sense, and ZoomInfo for trade show attendee data.",
  openGraph: {
    title: "Compare WhoGoes — Trade Show Attendee List Alternatives",
    description:
      "See how WhoGoes compares to alternatives for trade show attendee data.",
    url: "https://app.whogoes.co/compare",
  },
  alternates: {
    canonical: "https://app.whogoes.co/compare",
  },
};

export default function ComparePage() {
  const comparisons = getAllComparisons();

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "WhoGoes Comparisons",
    itemListElement: comparisons.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `https://app.whogoes.co/compare/${c.meta.slug}`,
      name: c.meta.title,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />

      <div className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-4xl">
          How WhoGoes Compares
        </h1>
        <p className="mt-3 text-lg text-zinc-600 dark:text-zinc-400">
          See how WhoGoes stacks up against the alternatives for getting trade
          show and event attendee data.
        </p>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {comparisons.map((c) => (
            <Link
              key={c.meta.slug}
              href={`/compare/${c.meta.slug}`}
              className="group rounded-xl border border-zinc-200 bg-white p-6 transition-all hover:border-emerald-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-700"
            >
              <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                vs {c.meta.competitor}
              </span>
              <h2 className="mt-3 text-lg font-semibold text-zinc-900 group-hover:text-emerald-600 dark:text-white dark:group-hover:text-emerald-400">
                {c.meta.title}
              </h2>
              <p className="mt-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                {c.meta.tagline}
              </p>
              <p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                {c.meta.description}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
