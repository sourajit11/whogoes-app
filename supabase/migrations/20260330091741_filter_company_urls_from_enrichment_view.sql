-- Pulled from remote on 2026-05-15. Originally applied via Supabase Studio.
-- Captured into local migrations for parity (rule: all DDL must be tracked).


CREATE OR REPLACE VIEW public.v_contacts_for_enrichment AS
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
    AND c.source <> 'mentioned'
    AND c.linkedin_url NOT LIKE '%/company/%'
    AND c.linkedin_url NOT LIKE '%/showcase/%'
    AND NOT EXISTS (
      SELECT 1
      FROM outreach_campaigns oc
      WHERE oc.contact_id = c.id AND oc.event_id = ce.event_id
    )
  ORDER BY ce.enrichment_priority DESC, c.created_at;
