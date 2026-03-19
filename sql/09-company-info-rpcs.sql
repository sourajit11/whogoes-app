-- ============================================
-- WhoGoes: Add Company HQ & Founded Year to RPCs
-- Run this in Supabase SQL Editor
--
-- This migration:
-- 1. Adds company_headquarters, company_founded_year, company_description
--    columns to the contacts table (if they don't already exist)
-- 2. Backfills from the companies table (if data exists there)
-- 3. Updates get_event_preview RPC to return new fields
-- 4. Updates get_subscribed_event_contacts RPC to return new fields
-- ============================================

-- Step 1: Add columns to contacts table (safe to re-run)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_headquarters TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_founded_year INTEGER;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_description TEXT;

-- Step 2: Backfill from companies table (matches on linkedin_url)
-- Only updates rows that don't have the data yet
UPDATE contacts c
SET
  company_headquarters = comp.headquarters,
  company_founded_year = comp.founded_year,
  company_description  = comp.description
FROM companies comp
WHERE c.company_linkedin_url = comp.linkedin_url
  AND c.company_linkedin_url IS NOT NULL
  AND c.company_linkedin_url != ''
  AND (c.company_headquarters IS NULL OR c.company_founded_year IS NULL);

-- Step 3: Update get_event_preview RPC
-- Returns 5 preview contacts for an event (used on event detail page)
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
  SELECT
    c.id AS contact_id,
    c.full_name,
    c.current_title,
    c.company_name,
    c.city,
    c.country,
    (SELECT COUNT(DISTINCT ce2.contact_id)
     FROM contact_events ce2
     WHERE ce2.event_id = p_event_id
    ) AS total_contacts,
    p.url AS post_url,
    p.posted_at AS post_date,
    c.company_domain,
    c.company_linkedin_url,
    c.company_industry,
    c.company_size,
    c.company_headquarters,
    c.company_founded_year,
    em.email,
    c.linkedin_url AS contact_linkedin_url
  FROM contacts c
  JOIN contact_events ce ON ce.contact_id = c.id
  LEFT JOIN posts p ON p.id = ce.post_id
  LEFT JOIN contact_emails em ON em.contact_id = c.id AND em.is_primary = true
  WHERE ce.event_id = p_event_id
  ORDER BY
    (CASE WHEN em.email IS NOT NULL AND em.email != '' THEN 0 ELSE 1 END),
    p.posted_at DESC NULLS LAST
  LIMIT 5;
END;
$$;


-- Step 4: Update get_subscribed_event_contacts RPC
-- Returns unlocked contacts for an event (used on Unlocked Events page)
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
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN;
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
    em.email,
    em.status AS email_status,
    em.provider AS email_provider,
    c.company_name,
    c.company_linkedin_url,
    c.company_domain,
    c.company_website,
    c.company_industry,
    c.company_size,
    c.company_headquarters,
    c.company_founded_year,
    c.company_description,
    p.url AS post_url,
    p.content AS post_content,
    p.posted_at AS post_date,
    p.source,
    c.first_line_personalization,
    cca.is_downloaded,
    cca.downloaded_at
  FROM customer_contact_access cca
  JOIN contacts c ON c.id = cca.contact_id
  LEFT JOIN contact_events ce ON ce.contact_id = c.id AND ce.event_id = p_event_id
  LEFT JOIN posts p ON p.id = ce.post_id
  LEFT JOIN contact_emails em ON em.contact_id = c.id AND em.is_primary = true
  WHERE cca.user_id = v_user_id
    AND cca.event_id = p_event_id
    AND (
      p_filter = 'all'
      OR (p_filter = 'new' AND cca.is_downloaded = false)
      OR (p_filter = 'processed' AND cca.is_downloaded = true)
      OR (p_filter = 'with_email' AND em.email IS NOT NULL AND em.email != '')
    )
  ORDER BY
    (CASE WHEN em.email IS NOT NULL AND em.email != '' THEN 0 ELSE 1 END),
    p.posted_at DESC NULLS LAST;
END;
$$;
