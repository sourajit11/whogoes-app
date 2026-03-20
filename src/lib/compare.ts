import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { ComparisonPost, ComparisonMeta } from "@/types/compare";

const COMPARE_DIR = path.join(process.cwd(), "src/content/compare");

/** Get all published comparisons, sorted newest first */
export function getAllComparisons(): ComparisonPost[] {
  if (!fs.existsSync(COMPARE_DIR)) return [];

  const files = fs.readdirSync(COMPARE_DIR).filter((f) => f.endsWith(".mdx"));

  const posts = files.map((filename) => {
    const filePath = path.join(COMPARE_DIR, filename);
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = matter(raw);
    return { meta: data as ComparisonMeta, content };
  });

  return posts
    .filter((p) => !p.meta.draft)
    .sort(
      (a, b) =>
        new Date(b.meta.date).getTime() - new Date(a.meta.date).getTime()
    );
}

/** Get a single comparison by slug, or null if not found / draft */
export function getComparisonBySlug(slug: string): ComparisonPost | null {
  const filePath = path.join(COMPARE_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const meta = data as ComparisonMeta;

  if (meta.draft) return null;
  return { meta, content };
}

/** Get all published slugs (for sitemap and static params) */
export function getAllComparisonSlugs(): string[] {
  return getAllComparisons().map((c) => c.meta.slug);
}

/** Estimate reading time in minutes */
export function getReadingTime(content: string): number {
  const words = content.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}
