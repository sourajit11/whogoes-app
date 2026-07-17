-- Pulled from remote on 2026-05-15. Originally applied via Supabase Studio.
-- Captured into local migrations for parity (rule: all DDL must be tracked).

ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS image_analysis jsonb;

COMMENT ON COLUMN public.posts.image_url IS 'URL of the first image attached to the post, captured from HarvestAPI postImages[0].url or article.image. LinkedIn URLs typically expire after ~30 days. NULL for posts scraped before this column was added.';

COMMENT ON COLUMN public.posts.image_analysis IS 'Structured AI vision analysis of the post image. Populated by Phase 2 Gemini Vision step. Schema: {has_image, image_url, image_type, extracted_text, visual_summary, supports_attendance, event_signals, analysis_status}. NULL when no image or analysis skipped.';
