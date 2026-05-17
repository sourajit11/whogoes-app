-- Production v_posts_with_events: exclude ad-hoc events
CREATE OR REPLACE VIEW v_posts_with_events AS
 SELECT p.id,
    p.post_url,
    p.event_id,
    p.author_linkedin_url,
    p.author_name,
    p.author_type,
    p.contact_id,
    p.company_id,
    p.content,
    p.posted_at,
    p.status,
    p.qualification_reason,
    p.created_at,
    p.updated_at,
    e.name AS event_name,
    e.keywords[1] AS event_keyword,
    e.keywords AS event_keywords,
    e.instantly_campaign_id AS event_campaign_id,
    e.region AS event_region,
    e.email_subject_template AS event_subject,
    p.mentioned_profiles,
    p.post_type,
    p.image_url,
    p.image_analysis
   FROM posts p
     LEFT JOIN events e ON p.event_id = e.id
  WHERE e.is_adhoc = false OR e.id IS NULL;

-- Ad-hoc variant
CREATE OR REPLACE VIEW v_posts_with_events_adhoc AS
 SELECT p.id,
    p.post_url,
    p.event_id,
    p.author_linkedin_url,
    p.author_name,
    p.author_type,
    p.contact_id,
    p.company_id,
    p.content,
    p.posted_at,
    p.status,
    p.qualification_reason,
    p.created_at,
    p.updated_at,
    e.name AS event_name,
    e.keywords[1] AS event_keyword,
    e.keywords AS event_keywords,
    e.instantly_campaign_id AS event_campaign_id,
    e.region AS event_region,
    e.email_subject_template AS event_subject,
    p.mentioned_profiles,
    p.post_type,
    p.image_url,
    p.image_analysis
   FROM posts p
     JOIN events e ON p.event_id = e.id
  WHERE e.is_adhoc = true;

COMMENT ON VIEW v_posts_with_events_adhoc IS
  'Ad-hoc variant of v_posts_with_events (events.is_adhoc=true only). Consumed by Phase 2/3 ad-hoc workflows. Posts with NULL event_id are excluded.';

-- Production v_mentions_pending: exclude ad-hoc events
CREATE OR REPLACE VIEW v_mentions_pending AS
 SELECT pm.id AS mention_id,
    pm.post_id,
    pm.mentioned_name,
    pm.contact_id,
    pm.company_linkedin_url,
    pm.enrichment_status,
    pm.created_at,
    p.content AS post_content,
    p.post_url,
    p.event_id,
    p.author_linkedin_url AS post_author_linkedin_url,
    e.name AS event_name,
    e.instantly_campaign_id AS event_campaign_id,
    e.region AS event_region,
    e.email_subject_template AS event_subject,
    pm.mentioned_linkedin_url
   FROM post_mentions pm
     JOIN posts p ON pm.post_id = p.id
     LEFT JOIN events e ON p.event_id = e.id
  WHERE pm.enrichment_status = 'pending'::text
    AND (e.is_adhoc = false OR e.id IS NULL)
    AND NOT (EXISTS ( SELECT 1
           FROM contacts c
             JOIN contact_events ce ON c.id = ce.contact_id
          WHERE lower(TRIM(BOTH FROM c.full_name)) = lower(TRIM(BOTH FROM pm.mentioned_name))
            AND ce.post_id = pm.post_id));

-- Ad-hoc variant
CREATE OR REPLACE VIEW v_mentions_pending_adhoc AS
 SELECT pm.id AS mention_id,
    pm.post_id,
    pm.mentioned_name,
    pm.contact_id,
    pm.company_linkedin_url,
    pm.enrichment_status,
    pm.created_at,
    p.content AS post_content,
    p.post_url,
    p.event_id,
    p.author_linkedin_url AS post_author_linkedin_url,
    e.name AS event_name,
    e.instantly_campaign_id AS event_campaign_id,
    e.region AS event_region,
    e.email_subject_template AS event_subject,
    pm.mentioned_linkedin_url
   FROM post_mentions pm
     JOIN posts p ON pm.post_id = p.id
     JOIN events e ON p.event_id = e.id
  WHERE pm.enrichment_status = 'pending'::text
    AND e.is_adhoc = true
    AND NOT (EXISTS ( SELECT 1
           FROM contacts c
             JOIN contact_events ce ON c.id = ce.contact_id
          WHERE lower(TRIM(BOTH FROM c.full_name)) = lower(TRIM(BOTH FROM pm.mentioned_name))
            AND ce.post_id = pm.post_id));

COMMENT ON VIEW v_mentions_pending_adhoc IS
  'Ad-hoc variant of v_mentions_pending (events.is_adhoc=true only). Consumed by Phase 5 ad-hoc workflow (617VHtrWhHZ1RqtR).';
