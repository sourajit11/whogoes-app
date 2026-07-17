-- Pulled from remote on 2026-05-15. Originally applied via Supabase Studio.
-- Captured into local migrations for parity (rule: all DDL must be tracked).

CREATE INDEX IF NOT EXISTS idx_posts_created_at ON public.posts USING btree (created_at DESC);
