export interface ComparisonMeta {
  title: string;
  description: string;
  date: string;
  updatedDate?: string;
  author?: string;
  slug: string;
  competitor: string;
  tagline: string;
  image?: string;
  draft?: boolean;
  faqs?: Array<{ question: string; answer: string }>;
}

export interface ComparisonPost {
  meta: ComparisonMeta;
  content: string;
}
