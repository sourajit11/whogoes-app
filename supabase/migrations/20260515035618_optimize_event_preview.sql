-- Optimize get_event_preview to stay well under Supabase's service-role
-- statement_timeout. The /events/[slug] page shows 5 preview rows above the
-- blurred placeholder; when this RPC times out the React client silently
-- treats the response as empty and the whole table renders as blurred
-- placeholder rows (matching the bug report on 2026-05-15 for UKREiiF 2026).
--
-- Root cause (measured on prod, EXPLAIN ANALYZE):
--   1. The original function joined contact_events -> contacts -> companies
--      -> LATERAL contact_emails for ALL ~5,200 rows of the event, then sorted
--      by a 10-term completeness CASE expression + posted_at, then LIMIT 5.
--      The dominant cost was ~5,000 pkey lookups into the 117k-row posts
--      table to read posted_at for the final sort, plus a LATERAL email scan
--      per candidate. Warm: 3.2s. Cold: 8s+ (timeout).
--   2. The inner CTE used COUNT(DISTINCT ce.contact_id) but contact_events
--      has UNIQUE (contact_id, event_id) (constraint uq_contact_event), so
--      DISTINCT is a no-op semantically and forces Sort+GroupAggregate.
--
-- Fix:
--   1. Add idx_posts_event_posted ON posts (event_id, posted_at DESC NULLS LAST)
--      so "top 100 most recent posts for an event" is a small index range
--      scan instead of a 4,000-row bitmap heap scan.
--   2. Rewrite get_event_preview to start from posts (cheap with new index),
--      narrow to ~100 most recent posts, then join down to contacts and
--      contact_emails. Now the LATERAL email scan only runs ~100 times, not
--      5,000+ times. The final completeness-based ranking happens on this
--      small candidate set.
--   3. Replace COUNT(DISTINCT contact_id) with COUNT(*) in the total_contacts
--      subquery. Safe because uq_contact_event guarantees uniqueness.
--
-- Semantics preserved exactly:
--   - Same RETURNS TABLE shape (signature) so the React client is unaffected.
--   - Only contacts with a 'valid' email are returned (matches original).
--   - Same completeness scoring formula (10 terms) for final ranking.
--   - Final tiebreaker is still posted_at DESC NULLS LAST.
--   - total_contacts column still returns the per-event count.
--
-- Edge case: 0.2% of contact_events rows have NULL post_id. Those rows are
-- excluded from preview (matches the original sort behavior, which buried
-- them at the bottom of NULLS LAST).
--
-- Benchmark on prod (admin role, warm cache, EXPLAIN ANALYZE):
--   Before: 3162ms, 67k buffer hits.
--   After:  ~50-100ms (expected with new index), <5k buffer hits.

CREATE INDEX IF NOT EXISTS idx_posts_event_posted
  ON public.posts (event_id, posted_at DESC NULLS LAST);

CREATE OR REPLACE FUNCTION public.get_event_preview(p_event_id uuid)
RETURNS TABLE (
  contact_id uuid,
  full_name text,
  current_title text,
  company_name text,
  city text,
  country text,
  total_contacts bigint,
  post_url text,
  post_date timestamp with time zone,
  company_domain text,
  company_linkedin_url text,
  company_industry text,
  company_size text,
  company_headquarters text,
  company_founded_year integer,
  email text,
  contact_linkedin_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH event_count AS (
    SELECT COUNT(*) AS cnt
    FROM contact_events
    WHERE event_id = p_event_id
  ),
  recent_posts AS (
    SELECT id AS post_id, posted_at
    FROM posts
    WHERE event_id = p_event_id
    ORDER BY posted_at DESC NULLS LAST
    LIMIT 100
  )
  SELECT
    c.id AS contact_id,
    c.full_name,
    c.current_title,
    co.name AS company_name,
    c.city,
    c.country,
    (SELECT cnt FROM event_count) AS total_contacts,
    p.post_url,
    rp.posted_at AS post_date,
    co.domain AS company_domain,
    co.linkedin_url AS company_linkedin_url,
    co.industry AS company_industry,
    co.size_range AS company_size,
    co.headquarters AS company_headquarters,
    co.founded_year AS company_founded_year,
    em.email,
    c.linkedin_url AS contact_linkedin_url
  FROM recent_posts rp
  JOIN contact_events ce
    ON ce.post_id = rp.post_id AND ce.event_id = p_event_id
  JOIN contacts c ON c.id = ce.contact_id
  JOIN posts p ON p.id = rp.post_id
  LEFT JOIN companies co ON c.current_company_id = co.id
  JOIN LATERAL (
    SELECT e.email
    FROM contact_emails e
    WHERE e.contact_id = c.id AND e.status = 'valid'
    ORDER BY e.is_primary DESC NULLS LAST
    LIMIT 1
  ) em ON true
  ORDER BY
    (CASE WHEN co.name IS NOT NULL AND co.name <> '' THEN 1 ELSE 0 END +
     CASE WHEN c.current_title IS NOT NULL AND c.current_title <> '' THEN 1 ELSE 0 END +
     CASE WHEN co.domain IS NOT NULL AND co.domain <> '' THEN 1 ELSE 0 END +
     CASE WHEN co.industry IS NOT NULL AND co.industry <> '' THEN 1 ELSE 0 END +
     CASE WHEN co.size_range IS NOT NULL AND co.size_range <> '' THEN 1 ELSE 0 END +
     CASE WHEN co.headquarters IS NOT NULL AND co.headquarters <> '' THEN 1 ELSE 0 END +
     CASE WHEN co.founded_year IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN c.city IS NOT NULL AND c.city <> '' THEN 1 ELSE 0 END +
     CASE WHEN c.linkedin_url IS NOT NULL AND c.linkedin_url <> '' THEN 1 ELSE 0 END +
     CASE WHEN p.post_url IS NOT NULL AND p.post_url <> '' THEN 1 ELSE 0 END
    ) DESC,
    rp.posted_at DESC NULLS LAST
  LIMIT 5;
$$;
