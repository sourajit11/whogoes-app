-- Pulled from remote on 2026-05-15. Originally applied via Supabase Studio.
-- Captured into local migrations for parity (rule: all DDL must be tracked).

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS post_type text;

ALTER TABLE public.posts
  DROP CONSTRAINT IF EXISTS posts_post_type_check;

ALTER TABLE public.posts
  ADD CONSTRAINT posts_post_type_check
  CHECK (post_type IS NULL OR post_type IN (
    'personal_attendance',
    'company_attendance',
    'third_party_confirmation',
    'brief_mention',
    'editorial_rejected',
    'past_event_rejected',
    'edition_mismatch_rejected',
    'other_rejected'
  ));

CREATE INDEX IF NOT EXISTS idx_posts_post_type ON public.posts(post_type);

COMMENT ON COLUMN public.posts.post_type IS 'Classification by Phase 2 AI qualifier. Qualified values: personal_attendance, company_attendance, third_party_confirmation, brief_mention. Rejected values: editorial_rejected, past_event_rejected, edition_mismatch_rejected, other_rejected. NULL for posts processed before this column was added.';
