-- ROLLBACK (down migration) for the organizer announcement coverage feature.
-- Reverses:
--   20260708120000_add_announcement_ingestion.sql
--   20260708120100_swap_posts_author_event_partial_index.sql
--
-- SHELF FILE ON PURPOSE: it lives in supabase/rollback/, NOT supabase/migrations/,
-- so `supabase db push` never picks it up. Run it by hand ONLY to fully revert the
-- feature. See app/docs/ANNOUNCEMENT_SCRAPER_PLAN.md section 9.
--
-- WARNING: this DELETEs every announcement post. Consequences (verified FK behavior):
--   - post_mentions of those posts: CASCADE deleted.
--   - contact_events.post_id -> SET NULL (the contact_event row survives; an already
--     enriched speaker keeps their event membership, only the post link is nulled).
--   - company_event_roles.evidence_post_id -> SET NULL (role rows survive).
-- Safe and idempotent whether or not part 2 (the index swap) was applied.

begin;

-- 1. Stop any new announcement inserts.
drop function if exists public.insert_announcement_post(text, uuid, text, text, text, timestamptz, text);

-- 2. Remove announcement rows so the original full unique can be rebuilt cleanly.
delete from public.posts where is_announcement = true;

-- 3. Retire the partial unique (if part 2 ran) and restore the original full unique.
drop index if exists public.idx_posts_author_event_notann;
create unique index if not exists idx_posts_author_event_unique
  on public.posts (author_linkedin_url, event_id)
  where author_linkedin_url is not null;

-- 4. Drop the added columns (after the index that referenced is_announcement is gone).
alter table public.posts  drop column if exists is_announcement;
alter table public.events drop column if exists organizer_linkedin_url;

commit;
