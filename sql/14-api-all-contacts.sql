-- ============================================
-- WhoGoes Public API — all-events contact fetch
-- Run AFTER 13-api-subscriptions.sql.
--
-- Use case: a user has unlocked from 10 events and wants to ingest the
-- whole portfolio into their CRM in one go. Without this RPC, they'd
-- have to call GET /events/:id/contacts ten times. Now: one call,
-- paginated, optionally filtered to "since last sync."
--
-- Response shape mirrors api_get_unlocked_contacts but adds event_id,
-- event_name, event_slug per row so clients can group by event without
-- a separate lookup.
-- ============================================

CREATE OR REPLACE FUNCTION api_get_all_unlocked_contacts(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_since TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_total INTEGER;
  v_contacts JSON;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM customer_contact_access cca
  WHERE cca.user_id = p_user_id
    AND (p_since IS NULL OR cca.charged_at >= p_since);

  SELECT json_agg(row_to_json(t)) INTO v_contacts
  FROM (
    SELECT
      cca.event_id,
      e.name AS event_name,
      e.slug AS event_slug,
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
      p.post_url,
      p.posted_at AS post_date,
      ce.source_type AS source,
      cca.charged_at,
      cca.is_downloaded
    FROM customer_contact_access cca
    JOIN events e ON e.id = cca.event_id
    JOIN contacts c ON c.id = cca.contact_id
    LEFT JOIN contact_events ce ON ce.contact_id = c.id AND ce.event_id = cca.event_id
    LEFT JOIN LATERAL (
      SELECT em.email, em.status, em.provider
      FROM contact_emails em
      WHERE em.contact_id = c.id AND em.status = 'valid'
      ORDER BY em.is_primary DESC NULLS LAST
      LIMIT 1
    ) cem ON true
    LEFT JOIN companies co ON c.current_company_id = co.id
    LEFT JOIN posts p ON ce.post_id = p.id
    WHERE cca.user_id = p_user_id
      AND (p_since IS NULL OR cca.charged_at >= p_since)
    ORDER BY cca.charged_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  RETURN json_build_object(
    'contacts', COALESCE(v_contacts, '[]'::json),
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'since', p_since,
    'has_more', (p_offset + p_limit) < v_total
  );
END;
$$;
