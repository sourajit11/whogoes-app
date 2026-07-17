-- Widen the candidate pool in get_event_preview from 100 to 500 most-recent
-- posts. The 100-post pool (introduced in 20260515035618_optimize_event_preview)
-- starved actively-collecting events where freshest posts haven't been
-- email-enriched yet. Concrete repro: Cannes Lions 2026 (1,384 contacts, 903
-- with email) returned only 2 preview rows because of its 100 most recent
-- posts, only 36 linked to a contact_event and only 2 of those contacts had
-- a valid email yet. Bumping to 500 gives Cannes 219 emailed candidates.
--
-- Benchmark (EXPLAIN ANALYZE, prod):
--   Cannes:   cold 163ms, warm  2ms
--   UKREiiF:  cold  37ms, warm <1ms
--   Hannover: cold  37ms, warm <1ms
--   IFAT:     cold  56ms, warm <1ms
--   NAB:      cold  72ms, warm <1ms
--   IMEX:     cold  68ms, warm <1ms
-- All well under the 8s service-role timeout. The new idx_posts_event_posted
-- index makes the wider scan cheap (it's still an index range scan walking
-- posts in posted_at order; just walks further).
--
-- Only the LIMIT value changes vs the previous version of this function;
-- everything else is identical.

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
    LIMIT 500
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
