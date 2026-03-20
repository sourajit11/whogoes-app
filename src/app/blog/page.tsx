import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts, getReadingTime } from "@/lib/blog";
import type { BlogPost } from "@/types/blog";

export const metadata: Metadata = {
  title: "Blog — Trade Show Outreach Tips & Event Guides",
  description:
    "Actionable guides for trade show attendee outreach, event-specific attendee list guides, and tips for using attendee data to book more meetings.",
  openGraph: {
    title: "Blog — Trade Show Outreach Tips & Event Guides",
    description:
      "Actionable guides for trade show attendee outreach and event-specific attendee list guides.",
    url: "https://app.whogoes.co/blog",
  },
  alternates: {
    canonical: "https://app.whogoes.co/blog",
  },
};

const CATEGORY_LABELS: Record<string, string> = {
  "event-guides": "Event Guides",
  "outreach-tactics": "Outreach Tactics",
  "attendee-data": "Attendee Data",
};

const CATEGORY_COLORS: Record<string, string> = {
  "event-guides":
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "outreach-tactics":
    "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "attendee-data":
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};

function BlogListJsonLd({ posts }: { posts: BlogPost[] }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "WhoGoes Blog",
    itemListElement: posts.map((post, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `https://app.whogoes.co/blog/${post.meta.slug}`,
      name: post.meta.title,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

function PostCard({ post }: { post: BlogPost }) {
  const readingTime = getReadingTime(post.content);

  return (
    <Link
      href={`/blog/${post.meta.slug}`}
      className="group block rounded-xl border border-zinc-200 bg-white p-6 transition-all hover:border-emerald-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-emerald-700"
    >
      {/* Category badge */}
      <span
        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
          CATEGORY_COLORS[post.meta.category] ||
          "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
        }`}
      >
        {CATEGORY_LABELS[post.meta.category] || post.meta.category}
      </span>

      {/* Title */}
      <h2 className="mt-3 text-lg font-semibold text-zinc-900 group-hover:text-emerald-600 dark:text-white dark:group-hover:text-emerald-400">
        {post.meta.title}
      </h2>

      {/* Description */}
      <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400 line-clamp-2">
        {post.meta.description}
      </p>

      {/* Meta */}
      <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-500">
        <time dateTime={post.meta.date}>
          {new Date(post.meta.date).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </time>
        <span>&middot;</span>
        <span>{readingTime} min read</span>
      </div>
    </Link>
  );
}

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const allPosts = getAllPosts();

  const filteredPosts = category
    ? allPosts.filter((p) => p.meta.category === category)
    : allPosts;

  const categories = [
    ...new Set(allPosts.map((p) => p.meta.category)),
  ];

  return (
    <>
      <BlogListJsonLd posts={filteredPosts} />

      <div className="mx-auto max-w-4xl px-6 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
            Blog
          </h1>
          <p className="mt-2 text-base text-zinc-600 dark:text-zinc-400">
            Trade show outreach tips, event attendee list guides, and strategies
            to book more meetings.
          </p>
        </div>

        {/* Category filters */}
        {categories.length > 1 && (
          <div className="mb-8 flex flex-wrap gap-2">
            <Link
              href="/blog"
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                !category
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}
            >
              All
            </Link>
            {categories.map((cat) => (
              <Link
                key={cat}
                href={`/blog?category=${cat}`}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  category === cat
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                }`}
              >
                {CATEGORY_LABELS[cat] || cat}
              </Link>
            ))}
          </div>
        )}

        {/* Posts grid */}
        {filteredPosts.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2">
            {filteredPosts.map((post) => (
              <PostCard key={post.meta.slug} post={post} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-zinc-500 dark:text-zinc-400">
              No posts found{category ? ` in "${CATEGORY_LABELS[category] || category}"` : ""}.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
