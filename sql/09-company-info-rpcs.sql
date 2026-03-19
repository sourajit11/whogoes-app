-- ============================================
-- WhoGoes: Add Company HQ & Founded Year to RPCs
-- Run this in Supabase SQL Editor
--
-- The companies table already has headquarters, founded_year, description.
-- These RPCs just need to include them in the SELECT.
-- ============================================

-- Drop the columns we accidentally added (they belong on companies, not contacts)
ALTER TABLE contacts DROP COLUMN IF EXISTS company_headquarters;
ALTER TABLE contacts DROP COLUMN IF EXISTS company_founded_year;
ALTER TABLE contacts DROP COLUMN IF EXISTS company_description;


-- Drop existing functions first (return type changed, CREATE OR REPLACE can't handle that)
DROP FUNCTION IF EXISTS get_event_preview(UUID);
DROP FUNCTION IF EXISTS get_subscribed_event_contacts(UUID, TEXT);

-- Update get_event_preview: add co.headquarters, co.founded_year
CREATE OR REPLACE FUNCTION get_event_preview(p_event_id UUID)
RETURNS TABLE (
  contact_id UUID,
  full_name TEXT,
  current_title TEXT,
  company_name TEXT,
  city TEXT,
  country TEXT,
  total_contacts BIGINT,
  post_url TEXT,
  post_date TIMESTAMPTZ,
  company_domain TEXT,
  company_linkedin_url TEXT,
  company_industry TEXT,
  company_size TEXT,
  company_headquarters TEXT,
  company_founded_year INTEGER,
  email TEXT,
  contact_linkedin_url TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH event_contact_count AS (
    SELECT COUNT(DISTINCT ce2.contact_id) AS cnt
    FROM contact_events ce2
    WHERE ce2.event_id = p_event_id
  )
  SELECT
    c.id AS contact_id,
    c.full_name,
    c.current_title,
    co.name AS company_name,
    c.city,
    c.country,
    ecc.cnt AS total_contacts,
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
  FROM contact_events ce
  JOIN contacts c ON c.id = ce.contact_id
  LEFT JOIN companies co ON c.current_company_id = co.id
  LEFT JOIN posts p ON ce.post_id = p.id
  LEFT JOIN LATERAL (
    SELECT e.email
    FROM contact_emails e
    WHERE e.contact_id = c.id AND e.status = 'valid'
    ORDER BY e.is_primary DESC NULLS LAST
    LIMIT 1
  ) em ON true
  CROSS JOIN event_contact_count ecc
  WHERE ce.event_id = p_event_id
    AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
    AND em.email IS NOT NULL
  ORDER BY p.posted_at DESC NULLS LAST
  LIMIT 5;
END;
$$;


-- Update get_subscribed_event_contacts: add co.headquarters, co.founded_year, co.description
CREATE OR REPLACE FUNCTION get_subscribed_event_contacts(p_event_id UUID, p_filter TEXT DEFAULT 'all')
RETURNS TABLE (
  contact_id UUID,
  full_name TEXT,
  first_name TEXT,
  last_name TEXT,
  current_title TEXT,
  headline TEXT,
  contact_linkedin_url TEXT,
  city TEXT,
  country TEXT,
  email TEXT,
  email_status TEXT,
  email_provider TEXT,
  company_name TEXT,
  company_linkedin_url TEXT,
  company_domain TEXT,
  company_website TEXT,
  company_industry TEXT,
  company_size TEXT,
  company_headquarters TEXT,
  company_founded_year INTEGER,
  company_description TEXT,
  post_url TEXT,
  post_content TEXT,
  post_date TIMESTAMPTZ,
  source TEXT,
  first_line_personalization TEXT,
  is_downloaded BOOLEAN,
  downloaded_at TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM customer_event_subscriptions
    WHERE user_id = auth.uid() AND event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Not subscribed to this event';
  END IF;

  RETURN QUERY
  SELECT
    c.id AS contact_id,
    c.full_name,
    c.first_name,
    c.last_name,
    c.current_title,
    c.headline,
    c.linkedin_url AS contact_linkedin_url,
    c.city,
    c.country,
    cem.email,
    cem.status AS email_status,
    cem.provider AS email_provider,
    co.name AS company_name,
    co.linkedin_url AS company_linkedin_url,
    co.domain AS company_domain,
    co.website AS company_website,
    co.industry AS company_industry,
    co.size_range AS company_size,
    co.headquarters AS company_headquarters,
    co.founded_year AS company_founded_year,
    co.description AS company_description,
    p.post_url,
    p.content AS post_content,
    p.posted_at AS post_date,
    ce.source_type AS source,
    ce.first_line_personalization,
    cca.is_downloaded,
    cca.downloaded_at
  FROM customer_contact_access cca
  JOIN contacts c ON c.id = cca.contact_id
  JOIN contact_events ce ON ce.contact_id = c.id AND ce.event_id = p_event_id
  LEFT JOIN contact_emails cem ON cem.contact_id = c.id AND cem.is_primary = true AND cem.status = 'valid'
  LEFT JOIN companies co ON c.current_company_id = co.id
  LEFT JOIN posts p ON ce.post_id = p.id
  WHERE cca.event_id = p_event_id
    AND cca.user_id = auth.uid()
    AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
    AND (
      p_filter = 'all'
      OR (p_filter = 'new' AND cca.is_downloaded = false)
      OR (p_filter = 'processed' AND cca.is_downloaded = true)
    )
  ORDER BY cca.charged_at DESC;
END;
$$;
