-- Track Apify scrape failures per contact so we can stop retrying after 3 attempts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS enrichment_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_enrichment_failed_at TIMESTAMPTZ;

COMMENT ON COLUMN contacts.enrichment_attempts IS
  'Count of failed Apify scrape attempts. Contacts with attempts >= 3 are excluded from v_contacts_for_enrichment.';

-- RPC called from the workflow when Apify returns no usable scrape data.
-- Increments the attempt counter and stamps the failure time.
CREATE OR REPLACE FUNCTION mark_apify_failed(p_contact_id UUID)
RETURNS TABLE(contact_id UUID, attempts INTEGER, exhausted BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts INTEGER;
BEGIN
  UPDATE contacts
  SET
    enrichment_attempts = enrichment_attempts + 1,
    last_enrichment_failed_at = now(),
    updated_at = now()
  WHERE id = p_contact_id
  RETURNING enrichment_attempts INTO v_attempts;

  RETURN QUERY SELECT p_contact_id, v_attempts, (v_attempts >= 3);
END;
$$;

GRANT EXECUTE ON FUNCTION mark_apify_failed(UUID) TO service_role;

-- Replace the enrichment view to exclude contacts that have hit the retry cap
CREATE OR REPLACE VIEW v_contacts_for_enrichment AS
SELECT c.id AS contact_id,
    c.linkedin_url,
    c.full_name,
    c.first_name,
    c.last_name,
    c.headline,
    c.current_title,
    c.current_company_id,
    c.city,
    c.country,
    c.source,
    c.is_enriched,
    ce.id AS contact_event_id,
    ce.event_id,
    ce.post_id AS source_post_id,
    ce.source_type,
    ce.first_line_personalization,
    ce.email_subject,
    e.name AS event_name,
    e.instantly_campaign_id AS event_campaign_id,
    e.region AS event_region,
    e.email_subject_template AS event_subject,
    p.content AS post_content,
    p.post_url,
    ce.enrichment_priority
FROM contacts c
JOIN contact_events ce ON c.id = ce.contact_id
JOIN events e ON ce.event_id = e.id
LEFT JOIN posts p ON ce.post_id = p.id
WHERE c.is_enriched = false
  AND c.enrichment_attempts < 3
  AND c.source <> 'mentioned'::text
  AND c.linkedin_url !~~ '%/company/%'::text
  AND c.linkedin_url !~~ '%/showcase/%'::text
  AND NOT EXISTS (
    SELECT 1
    FROM outreach_campaigns oc
    WHERE oc.contact_id = c.id AND oc.event_id = ce.event_id
  )
ORDER BY c.enrichment_attempts ASC, ce.enrichment_priority DESC, c.created_at;
