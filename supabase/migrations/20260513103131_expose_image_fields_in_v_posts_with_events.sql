-- Pulled from remote on 2026-05-15. Originally applied via Supabase Studio.
-- Captured into local migrations for parity (rule: all DDL must be tracked).

CREATE OR REPLACE VIEW public.v_posts_with_events AS
SELECT
    p.id,
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
    e.name                    AS event_name,
    e.keywords[1]             AS event_keyword,
    e.keywords                AS event_keywords,
    e.instantly_campaign_id   AS event_campaign_id,
    e.region                  AS event_region,
    e.email_subject_template  AS event_subject,
    p.mentioned_profiles,
    p.post_type,
    p.image_url,
    p.image_analysis
FROM public.posts p
LEFT JOIN public.events e ON p.event_id = e.id;
