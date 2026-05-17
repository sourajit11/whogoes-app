ALTER TABLE events
  ADD COLUMN IF NOT EXISTS is_adhoc boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN events.is_adhoc IS
  'true = ad-hoc client request (WhoGoes/past events). Skips Instantly outreach. Enrichment runs via workflow BoV1lJqdxupGsAEb instead of qJBes5u8Kor07AZD.';

CREATE INDEX IF NOT EXISTS idx_events_is_adhoc ON events(is_adhoc) WHERE is_adhoc = true;

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
    AND e.is_adhoc = false
    AND NOT (EXISTS ( SELECT 1
           FROM outreach_campaigns oc
          WHERE oc.contact_id = c.id AND oc.event_id = ce.event_id))
  ORDER BY c.enrichment_attempts, ce.enrichment_priority DESC, c.created_at;

CREATE OR REPLACE VIEW v_contacts_for_enrichment_adhoc AS
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
    AND e.is_adhoc = true
  ORDER BY c.enrichment_attempts, ce.enrichment_priority DESC, c.created_at;

COMMENT ON VIEW v_contacts_for_enrichment_adhoc IS
  'Unenriched contacts for ad-hoc client events (events.is_adhoc=true). Consumed by workflow BoV1lJqdxupGsAEb. No outreach_campaigns exclusion since ad-hoc workflow does not write to that table.';
