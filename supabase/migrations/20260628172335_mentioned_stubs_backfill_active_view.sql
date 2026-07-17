-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
create or replace view public.v_mentioned_stubs_backfill_active as
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
join events e    on p.event_id = e.id
where c.source = 'mentioned'
  and c.is_enriched = false
  and c.current_title is null
  and c.current_company_id is null
  and c.linkedin_url ~ '/in/'
  and pm.mentioned_linkedin_url ~ '/in/'
  and (e.is_active = true or (e.is_whogoes_active = true and e.start_date > current_date))
order by pm.created_at;

grant select on public.v_mentioned_stubs_backfill_active to anon, authenticated, service_role;
