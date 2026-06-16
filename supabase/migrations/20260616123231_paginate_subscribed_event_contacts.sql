-- Fix "We couldn't load these contacts" on large unlocked events (e.g. Cannes
-- Lions 2026, ~6,700 unlocked contacts).
--
-- The My Events table paginated with PostgREST `.range()` over the RPC result.
-- PostgREST cannot push LIMIT/OFFSET into a plpgsql RETURN QUERY function, so
-- every page recomputed the FULL result set: all unlocked rows joined through
-- contacts + LATERAL contact_emails + companies + posts, then sliced. At ~6,700
-- rows each page exceeded the 8s statement_timeout (error 57014) and the client
-- showed the load error.
--
-- Root fix (candidate-first, same pattern as get_event_preview): add p_limit /
-- p_offset. We pick the page of customer_contact_access rows FIRST, ordered by
-- charged_at DESC using a new (user_id, event_id, charged_at DESC) index, then
-- join only those <=1,000 rows. Each page now touches a bounded set instead of
-- the whole event. p_limit defaults to NULL to preserve the old "return all"
-- behaviour for any other caller.

CREATE INDEX IF NOT EXISTS idx_cca_user_event_charged
  ON public.customer_contact_access (user_id, event_id, charged_at DESC);

DROP FUNCTION IF EXISTS get_subscribed_event_contacts(uuid, text);

CREATE OR REPLACE FUNCTION get_subscribed_event_contacts(
  p_event_id UUID,
  p_filter TEXT DEFAULT 'all',
  p_limit INTEGER DEFAULT NULL,
  p_offset INTEGER DEFAULT 0
)
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
SET search_path = 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM customer_event_subscriptions
    WHERE user_id = auth.uid() AND event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Not subscribed to this event';
  END IF;

  RETURN QUERY
  -- Select only the page of access rows first (index-ordered), then join.
  WITH page AS (
    SELECT cca.contact_id, cca.charged_at, cca.is_downloaded, cca.downloaded_at
    FROM customer_contact_access cca
    WHERE cca.event_id = p_event_id
      AND cca.user_id = auth.uid()
      AND (
        p_filter = 'all'
        OR (p_filter = 'new' AND cca.is_downloaded = false)
        OR (p_filter = 'processed' AND cca.is_downloaded = true)
      )
    ORDER BY cca.charged_at DESC
    LIMIT p_limit OFFSET p_offset
  )
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
    page.is_downloaded,
    page.downloaded_at
  FROM page
  JOIN contacts c ON c.id = page.contact_id
  JOIN contact_events ce ON ce.contact_id = c.id AND ce.event_id = p_event_id
  LEFT JOIN LATERAL (
    SELECT e.email, e.status, e.provider
    FROM contact_emails e
    WHERE e.contact_id = c.id AND e.status = 'valid'
    ORDER BY e.is_primary DESC NULLS LAST
    LIMIT 1
  ) cem ON true
  LEFT JOIN companies co ON c.current_company_id = co.id
  LEFT JOIN posts p ON ce.post_id = p.id
  ORDER BY page.charged_at DESC;
END;
$$;
