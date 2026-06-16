import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllPosts } from "@/lib/blog";
import { getAllComparisons } from "@/lib/compare";
import { contentUrl } from "@/lib/site";
import { getBrowsableEventsCached } from "@/lib/events/get-browsable-events";
import {
  EVENT_INDEX_MODE,
  isEventIndexable,
} from "@/lib/events/indexing";

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
        url: contentUrl("/events"),
        lastModified: new Date(),
        changeFrequency: "daily" as const,
        priority: 1.0,
      },
      {
        url: contentUrl("/blog"),
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.9,
      },
      {
        url: contentUrl("/compare"),
        lastModified: new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.9,
      },
      ...blogPosts.map((post) => ({
        url: contentUrl(`/blog/${post.meta.slug}`),
        lastModified: new Date(post.meta.date),
        changeFrequency: "monthly" as const,
        priority: 0.9,
      })),
    ];
  }

  // Sitemap 1: Comparison pages
  if (sitemapId === 1) {
    return getAllComparisons().map((c) => ({
      url: contentUrl(`/compare/${c.meta.slug}`),
      lastModified: new Date(c.meta.updatedDate ?? c.meta.date),
      changeFrequency: "monthly" as const,
      priority: 0.85,
    }));
  }

  // Sitemap 2: Event pages — LOWEST PRIORITY.
  // Only list indexable events; isEventIndexable() is the shared policy with
  // the page's robots meta, so the sitemap never advertises a noindexed page.
  let indexableSlugs: string[];

  if (EVENT_INDEX_MODE === "gate") {
    // Gate mode needs counts/location/industry/date — use the cached browsable
    // list (1h revalidate) which carries all gate fields.
    const events = await getBrowsableEventsCached();
    indexableSlugs = events
      .filter((event) => isEventIndexable(event))
      .map((event) => event.event_slug)
      .filter((slug): slug is string => !!slug);
  } else {
    // Denylist mode only needs the slug; keep the cheap raw query.
    const supabase = createAdminClient();
    const { data: events } = await supabase
      .from("events")
      .select("slug")
      .order("start_date", { ascending: false });
    indexableSlugs = (events ?? [])
      .filter((event) => isEventIndexable({ event_slug: event.slug }))
      .map((event) => event.slug);
  }

  return indexableSlugs.map((slug) => ({
    url: contentUrl(`/events/${slug}`),
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));
}
