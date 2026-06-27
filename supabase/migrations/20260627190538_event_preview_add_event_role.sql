-- Add event_role + is_speaker to get_event_preview so the public event-page preview table
-- can show a Role column next to Title (matching the My Events table). Role is the effective
-- per-contact role, derived identically to event_filtered_contact_ids: a confirmed
-- organizer/sponsor/exhibitor from company_event_roles wins; otherwise a speaker or a
-- first-person/mention post makes them a confirmed attendee; a bare repost is expected.
-- Adding columns to the end of the OUT row keeps existing callers backward compatible.
DROP FUNCTION IF EXISTS public.get_event_preview(uuid);

CREATE FUNCTION public.get_event_preview(p_event_id uuid)
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
  contact_linkedin_url text,
  event_role text,
  is_speaker boolean
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
  candidates AS (
    SELECT ce.contact_id, ce.post_id, ce.created_at, ce.is_speaker, ce.source_type
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
    c.linkedin_url AS contact_linkedin_url,
    CASE
      WHEN COALESCE(cer.role, 'attendee') IN ('organizer','sponsor','exhibitor') THEN cer.role
      WHEN COALESCE(cd.is_speaker, false) OR cd.source_type IN ('post_author','mentioned') THEN 'attendee'
      ELSE 'expected_attendee'
    END AS event_role,
    COALESCE(cd.is_speaker, false) AS is_speaker
  FROM candidates cd
  JOIN contacts c ON c.id = cd.contact_id
  JOIN posts p ON p.id = cd.post_id
  LEFT JOIN companies co ON c.current_company_id = co.id
  LEFT JOIN company_event_roles cer ON cer.event_id = p_event_id AND cer.company_id = c.current_company_id
  LEFT JOIN LATERAL (
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

GRANT EXECUTE ON FUNCTION public.get_event_preview(uuid) TO anon, authenticated, service_role;
