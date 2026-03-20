export interface ComparisonMeta {
  title: string;
  description: string;
  date: string;
  slug: string;
  competitor: string;
  tagline: string;
  draft?: boolean;
  faqs?: Array<{ question: string; answer: string }>;
}

export interface ComparisonPost {
  meta: ComparisonMeta;
  content: string;
}
