export interface BlogPostMeta {
  title: string;
  description: string;
  date: string; // ISO 8601: "2026-03-20"
  author: string;
  category: "event-guides" | "outreach-tactics" | "attendee-data";
  tags: string[];
  slug: string;
  image?: string; // OG image path relative to /public/blog/
  updatedDate?: string; // ISO 8601: "2026-03-22" — used for dateModified in JSON-LD
  draft?: boolean; // true = excluded from listing + sitemap
  faqs?: Array<{
    question: string;
    answer: string;
  }>;
  howto?: {
    name: string;
    description: string;
    steps: Array<{
      name: string;
      text: string;
    }>;
  };
}

export interface BlogPost {
  meta: BlogPostMeta;
  content: string; // Raw MDX string (without frontmatter)
}
