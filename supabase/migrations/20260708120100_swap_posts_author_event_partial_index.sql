-- Organizer announcement coverage, part 2 of 2: the ONE shared-infra change.
-- See app/docs/ANNOUNCEMENT_SCRAPER_PLAN.md. Requires part 1 (is_announcement) first.
--
-- Relax the author+event uniqueness so ONLY announcement rows escape it; normal
-- posts keep the exact old rule (one row per author per event).
--
-- Zero-gap ordering: create the replacement partial unique FIRST (it coexists with
-- the old full unique and enforces the identical rule for existing rows, which all
-- have is_announcement=false), then drop the old one. There is never a moment
-- without author+event uniqueness for normal posts.
--
-- LOCK NOTE: this builds the index non-concurrently (CONCURRENTLY cannot run inside
-- a migration transaction). On ~312k rows this is a few seconds and takes a SHARE
-- lock that briefly blocks writes to posts. APPLY IN A LOW-WRITE WINDOW (outside the
-- daily scraper run). If you prefer zero write-blocking, run the two statements by
-- hand with CONCURRENTLY instead and record them here.

-- Replacement: same columns + WHERE, plus AND NOT is_announcement.
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_author_event_notann
  ON public.posts (author_linkedin_url, event_id)
  WHERE author_linkedin_url IS NOT NULL AND NOT is_announcement;

-- Old full unique retired only after the replacement exists.
DROP INDEX IF EXISTS public.idx_posts_author_event_unique;
