import fs from "fs";
import path from "path";
import matter from "gray-matter";
import type { BlogPost, BlogPostMeta } from "@/types/blog";

const BLOG_DIR = path.join(process.cwd(), "src/content/blog");

/** Get all published posts, sorted newest first */
export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(BLOG_DIR)) return [];

  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".mdx"));

  const posts = files.map((filename) => {
    const filePath = path.join(BLOG_DIR, filename);
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = matter(raw);
    return { meta: data as BlogPostMeta, content };
  });

  return posts
    .filter((p) => !p.meta.draft)
    .sort(
      (a, b) =>
        new Date(b.meta.date).getTime() - new Date(a.meta.date).getTime()
    );
}

/** Get a single post by slug, or null if not found / draft */
export function getPostBySlug(slug: string): BlogPost | null {
  const filePath = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const meta = data as BlogPostMeta;

  if (meta.draft) return null;
  return { meta, content };
}

/** Get all published slugs (for sitemap and static params) */
export function getAllSlugs(): string[] {
  return getAllPosts().map((p) => p.meta.slug);
}

/** Estimate reading time in minutes */
export function getReadingTime(content: string): number {
  const words = content.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}
