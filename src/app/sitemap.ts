import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllPosts } from "@/lib/blog";
import { getAllComparisons } from "@/lib/compare";
import noindexedConfig from "@/config/noindexed-event-slugs.json";

const NOINDEXED_SLUGS = new Set<string>(noindexedConfig.slugs);

/**
 * Split sitemap into 3 parts so Google crawls blogs first:
 *   /sitemap/0.xml — Static pages + Blog posts (priority 0.9–1.0)
 *   /sitemap/1.xml — Comparison pages (priority 0.85)
 *   /sitemap/2.xml — Event pages (priority 0.5)
 */
export async function generateSitemaps() {
  return [{ id: 0 }, { id: 1 }, { id: 2 }];
}

// Next.js 16 passes params as Promises (async params) — must await
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function sitemap(props: any): Promise<MetadataRoute.Sitemap> {
  // props may be { id: Promise<number> } or Promise<{ id: number }> in Next.js 16
  const resolved = await Promise.resolve(props);
  const rawId = await Promise.resolve(resolved.id);
  const sitemapId = Number(rawId);

  // Sitemap 0: Static pages + Blog — HIGHEST PRIORITY
  if (sitemapId === 0) {
    const blogPosts = getAllPosts();
    return [
      {
        url: "https://app.whogoes.co/events",
        lastModified: new Date(),
        changeFrequency: "daily" as const,
        priority: 1.0,
      },
      {
        url: "https://app.whogoes.co/blog",
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.9,
      },
      {
        url: "https://app.whogoes.co/compare",
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.9,
      },
      ...blogPosts.map((post) => ({
        url: `https://app.whogoes.co/blog/${post.meta.slug}`,
        lastModified: new Date(post.meta.date),
        changeFrequency: "monthly" as const,
        priority: 0.9,
      })),
    ];
  }

  // Sitemap 1: Comparison pages
  if (sitemapId === 1) {
    return getAllComparisons().map((c) => ({
      url: `https://app.whogoes.co/compare/${c.meta.slug}`,
      lastModified: new Date(c.meta.date),
      changeFrequency: "monthly" as const,
      priority: 0.85,
    }));
  }

  // Sitemap 2: Event pages — LOWEST PRIORITY
  const supabase = createAdminClient();
  const { data: events } = await supabase
    .from("events")
    .select("slug")
    .order("start_date", { ascending: false });

  return (events ?? [])
    .filter((event) => !NOINDEXED_SLUGS.has(event.slug))
    .map((event) => ({
      url: `https://app.whogoes.co/events/${event.slug}`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.5,
    }));
}
