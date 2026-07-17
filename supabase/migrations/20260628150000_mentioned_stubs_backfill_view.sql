-- Backfill source view for the one-off "Phase 5b: Mentioned Backfill" workflow.
-- ~3,000 mentioned-source contacts are bare stubs (name + linkedin_url only): the
-- old Apify Phase 5 created them, failed to find an email, and its no-email path
-- saved only name+url (never calling enrich_contact), discarding the profile. They
-- are unreachable by both live workflows: Phase 4 excludes source='mentioned', and
-- Phase 5's v_mentions_pending_master excludes any mention already linked to a
-- contact (NOT EXISTS) and requires enrichment_status='pending' (these are 'no_email').
-- This view re-feeds exactly those stubs into the Phase 5 enrichment subgraph,
-- mirroring v_mentions_pending_master's columns so the workflow nodes resolve.
-- Convergence: enrich_contact sets is_enriched=true, so every processed contact
-- drops out of this view on the next pass (no reprocessing loop).
create or replace view public.v_mentioned_stubs_backfill as
select pm.id                      as mention_id,
       pm.post_id,
       pm.mentioned_name,
       pm.contact_id,
       pm.company_linkedin_url,
       pm.enrichment_status,
       pm.created_at,
       p.content                  as post_content,
       p.post_url,
       p.event_id,
       p.author_linkedin_url      as post_author_linkedin_url,
       e.name                     as event_name,
       e.instantly_campaign_id    as event_campaign_id,
       e.region                   as event_region,
       e.email_subject_template   as event_subject,
       e.is_active                as event_is_active,
       e.whogoes_only             as event_whogoes_only,
       pm.mentioned_linkedin_url
from post_mentions pm
join posts p     on pm.post_id = p.id
join contacts c  on c.id = pm.contact_id
left join events e on p.event_id = e.id
where c.source = 'mentioned'
  and c.is_enriched = false
  and c.current_title is null
  and c.current_company_id is null
  and c.linkedin_url ~ '/in/'
  and pm.mentioned_linkedin_url ~ '/in/'
order by pm.created_at;

grant select on public.v_mentioned_stubs_backfill to anon, authenticated, service_role;
