-- View: v_shootday_missing_personalization
-- Source for the "Phase 4b: Personalization Backfill" n8n workflow.
-- Returns Shootday-eligible, already-enriched contacts that have a valid email
-- but are missing their Gemini first-line personalization AND were never pushed
-- to Instantly (no outreach_campaigns row). These are "stranded" contacts that
-- got an email found but never received personalization, so they must be
-- re-personalized and pushed WITHOUT paying for re-enrichment.
--
-- One row per (contact, event); picks the best valid email (primary, then most
-- recently verified/created).

CREATE OR REPLACE VIEW public.v_shootday_missing_personalization AS
SELECT DISTINCT ON (ce.id)
    c.id                      AS contact_id,
    c.linkedin_url,
    c.full_name,
    c.first_name,
    c.last_name,
    ce.id                     AS contact_event_id,
    ce.event_id,
    ce.post_id                AS source_post_id,
    ce.source_type,
    ce.first_line_personalization,
    e.name                    AS event_name,
    e.instantly_campaign_id   AS event_campaign_id,
    e.region                  AS event_region,
    e.email_subject_template  AS event_subject,
    COALESCE(co.name, '')     AS company_name,
    p.content                 AS post_content,
    p.post_url,
    cem.id                    AS contact_email_id,
    cem.email                 AS found_email,
    cem.provider              AS email_source
FROM contacts c
    JOIN contact_events ce ON ce.contact_id = c.id
    JOIN events e ON e.id = ce.event_id
    JOIN contact_emails cem
        ON cem.contact_id = c.id
       AND cem.status = 'valid'
       AND cem.invalidated_at IS NULL
    LEFT JOIN companies co ON co.id = c.current_company_id
    LEFT JOIN posts p ON p.id = ce.post_id
WHERE c.is_enriched = TRUE
    AND e.is_active = TRUE
    AND (e.whogoes_only = FALSE OR e.whogoes_only IS NULL)
    AND (ce.first_line_personalization IS NULL OR btrim(ce.first_line_personalization) = '')
    AND NOT EXISTS (
        SELECT 1 FROM outreach_campaigns oc
        WHERE oc.contact_id = c.id AND oc.event_id = ce.event_id
    )
ORDER BY ce.id, cem.is_primary DESC, cem.verified_at DESC NULLS LAST, cem.created_at DESC;

COMMENT ON VIEW public.v_shootday_missing_personalization IS
    'Stranded Shootday contacts: enriched + valid email but missing personalization and not yet in outreach. Source for Phase 4b Personalization Backfill workflow.';
