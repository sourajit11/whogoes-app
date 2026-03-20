import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { getPostBySlug, getAllSlugs, getReadingTime } from "@/lib/blog";
import { mdxComponents } from "@/components/mdx-components";
import type { BlogPostMeta } from "@/types/blog";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "Post Not Found" };

  return {
    title: post.meta.title,
    description: post.meta.description,
    openGraph: {
      title: post.meta.title,
      description: post.meta.description,
      url: `https://app.whogoes.co/blog/${slug}`,
      type: "article",
      publishedTime: post.meta.date,
      authors: [post.meta.author],
      ...(post.meta.image && {
        images: [`https://app.whogoes.co/blog/${post.meta.image}`],
      }),
    },
    twitter: {
      card: "summary_large_image",
      title: post.meta.title,
      description: post.meta.description,
    },
    alternates: {
      canonical: `https://app.whogoes.co/blog/${slug}`,
    },
  };
}

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

function ArticleJsonLd({ meta }: { meta: BlogPostMeta }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: meta.title,
    description: meta.description,
    datePublished: meta.date,
    author: {
      "@type": "Organization",
      name: "WhoGoes",
      url: "https://whogoes.co",
    },
    publisher: {
      "@type": "Organization",
      name: "WhoGoes",
      url: "https://whogoes.co",
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `https://app.whogoes.co/blog/${meta.slug}`,
    },
    ...(meta.image && {
      image: `https://app.whogoes.co/blog/${meta.image}`,
    }),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

function FaqJsonLd({
  faqs,
}: {
  faqs: Array<{ question: string; answer: string }>;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  "event-guides": "Event Guides",
  "outreach-tactics": "Outreach Tactics",
  "attendee-data": "Attendee Data",
};

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const readingTime = getReadingTime(post.content);

  return (
    <>
      <ArticleJsonLd meta={post.meta} />
      {post.meta.faqs && <FaqJsonLd faqs={post.meta.faqs} />}

      <article className="mx-auto max-w-3xl px-6 py-12">
        {/* Category badge */}
        <div className="mb-4">
          <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
            {CATEGORY_LABELS[post.meta.category] || post.meta.category}
          </span>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-4xl">
          {post.meta.title}
        </h1>

        {/* Meta line */}
        <div className="mt-4 flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <span>{post.meta.author}</span>
          <span>&middot;</span>
          <time dateTime={post.meta.date}>
            {new Date(post.meta.date).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
          <span>&middot;</span>
          <span>{readingTime} min read</span>
        </div>

        {/* Tags */}
        {post.meta.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {post.meta.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Divider */}
        <hr className="my-8 border-zinc-200 dark:border-zinc-800" />

        {/* MDX content */}
        <div className="mdx-content">
          <MDXRemote
            source={post.content}
            components={mdxComponents}
            options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
          />
        </div>
      </article>
    </>
  );
}
