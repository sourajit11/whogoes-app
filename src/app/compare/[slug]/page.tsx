import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import {
  getComparisonBySlug,
  getAllComparisonSlugs,
  getReadingTime,
} from "@/lib/compare";
import { mdxComponents } from "@/components/mdx-components";
import type { ComparisonMeta } from "@/types/compare";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getComparisonBySlug(slug);
  if (!post) return { title: "Comparison Not Found" };

  return {
    title: post.meta.title,
    description: post.meta.description,
    openGraph: {
      title: post.meta.title,
      description: post.meta.description,
      url: `https://app.whogoes.co/compare/${slug}`,
      type: "article",
      publishedTime: post.meta.date,
      ...(post.meta.updatedDate && {
        modifiedTime: post.meta.updatedDate,
      }),
      ...(post.meta.author && {
        authors: [post.meta.author],
      }),
      ...(post.meta.image && {
        images: [`https://app.whogoes.co/compare/${post.meta.image}`],
      }),
    },
    twitter: {
      card: "summary_large_image",
      title: post.meta.title,
      description: post.meta.description,
    },
    alternates: {
      canonical: `https://app.whogoes.co/compare/${slug}`,
    },
  };
}

export function generateStaticParams() {
  return getAllComparisonSlugs().map((slug) => ({ slug }));
}

function ArticleJsonLd({ meta }: { meta: ComparisonMeta }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: meta.title,
    description: meta.description,
    datePublished: meta.date,
    dateModified: meta.updatedDate || meta.date,
    author: {
      "@type": "Person",
      name: meta.author || "Sam Kumar",
      url: "https://www.linkedin.com/in/sam-kumar-162156329/",
      sameAs: "https://www.linkedin.com/in/sam-kumar-162156329/",
    },
    publisher: {
      "@type": "Organization",
      name: "WhoGoes",
      url: "https://whogoes.co",
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `https://app.whogoes.co/compare/${meta.slug}`,
    },
    ...(meta.image && {
      image: `https://app.whogoes.co/compare/${meta.image}`,
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

function BreadcrumbJsonLd({
  title,
  slug,
}: {
  title: string;
  slug: string;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://whogoes.co",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Compare",
        item: "https://app.whogoes.co/compare",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: title,
        item: `https://app.whogoes.co/compare/${slug}`,
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export default async function ComparisonPage({ params }: Props) {
  const { slug } = await params;
  const post = getComparisonBySlug(slug);
  if (!post) notFound();

  const readingTime = getReadingTime(post.content);

  return (
    <>
      <ArticleJsonLd meta={post.meta} />
      <BreadcrumbJsonLd title={post.meta.title} slug={post.meta.slug} />
      {post.meta.faqs && <FaqJsonLd faqs={post.meta.faqs} />}

      <article className="mx-auto max-w-3xl px-6 py-12">
        {/* Badge */}
        <div className="mb-4">
          <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
            vs {post.meta.competitor}
          </span>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-4xl">
          {post.meta.title}
        </h1>

        {/* Tagline */}
        <p className="mt-3 text-xl font-semibold text-emerald-600 dark:text-emerald-400">
          {post.meta.tagline}
        </p>

        {/* Meta line */}
        <div className="mt-4 flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <span>{post.meta.author || "Sam Kumar"}</span>
          <span>&middot;</span>
          <time dateTime={post.meta.date}>
            {new Date(post.meta.date).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
          {post.meta.updatedDate && post.meta.updatedDate !== post.meta.date && (
            <>
              <span>&middot;</span>
              <span>
                Updated{" "}
                <time dateTime={post.meta.updatedDate}>
                  {new Date(post.meta.updatedDate).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </time>
              </span>
            </>
          )}
          <span>&middot;</span>
          <span>{readingTime} min read</span>
        </div>

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
