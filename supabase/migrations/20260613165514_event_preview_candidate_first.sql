-- Fix get_event_preview hitting the anon 3s statement_timeout on large events.
--
-- Cannes Lions 2026 grew from 4,541 -> 6,193 contacts (4,295 linked posts).
-- The previous version (20260610000001) found "the 500 most recent posts" by
-- reading posts.posted_at for ALL linked posts, then sorting. On a cold cache
-- that is ~4,300 random heap fetches into posts (~17k buffers) and ran ~5s.
-- Signed-out visitors hit Postgres as the `anon` role (statement_timeout = 3s),
-- so the cold run aborted with error 57014 -> "The preview took too long".
--
-- Root fix: pick candidates straight from contact_events ordered by its own
-- created_at, using a new (event_id, created_at DESC) index. That returns at
-- most N rows pre-sorted with no scan of posts at all. We only touch
-- posts/contacts/companies/contact_emails for those N candidates, then score
-- for completeness and return the top 5. contact_events is unique per
-- (contact_id, event_id) so candidates are already distinct contacts.
-- Measured on Cannes: ~5s cold -> ~20ms.

CREATE INDEX IF NOT EXISTS idx_contact_events_event_created
  ON public.contact_events (event_id, created_at DESC);

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
  -- Most-recently-linked candidates for this event. The (event_id,
  -- created_at DESC) index serves these rows pre-sorted, so we never read
  -- more than the LIMIT regardless of how large the event is.
  candidates AS (
    SELECT ce.contact_id, ce.post_id, ce.created_at
    FROM contact_events ce
    WHERE ce.event_id = p_event_id
      AND ce.post_id IS NOT NULL
    ORDER BY ce.created_at DESC
    LIMIT 150
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
    p.posted_at AS post_date,
    co.domain AS company_domain,
    co.linkedin_url AS company_linkedin_url,
    co.industry AS company_industry,
    co.size_range AS company_size,
    co.headquarters AS company_headquarters,
    co.founded_year AS company_founded_year,
    em.email,
    c.linkedin_url AS contact_linkedin_url
  FROM candidates cd
  JOIN contacts c ON c.id = cd.contact_id
  JOIN posts p ON p.id = cd.post_id
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
    cd.created_at DESC
  LIMIT 5;
$$;
