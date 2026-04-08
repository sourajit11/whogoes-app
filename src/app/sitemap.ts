import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllPosts } from "@/lib/blog";
import { getAllComparisons } from "@/lib/compare";

/**
 * Split sitemap into 3 parts so Google crawls blogs first:
 *   /sitemap/0.xml — Static pages + Blog posts (priority 0.9–1.0)
 *   /sitemap/1.xml — Comparison pages (priority 0.85)
 *   /sitemap/2.xml — Event pages (priority 0.5)
 */
export async function generateSitemaps() {
  return [{ id: 0 }, { id: 1 }, { id: 2 }];
}

export default async function sitemap({
  id,
}: {
  id: number;
}): Promise<MetadataRoute.Sitemap> {
  // Sitemap 0: Static pages + Blog — HIGHEST PRIORITY
  if (id === 0) {
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
  if (id === 1) {
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

  return (events ?? []).map((event) => ({
    url: `https://app.whogoes.co/events/${event.slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));
}
