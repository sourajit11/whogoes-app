-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
drop function if exists public.spd_list_personas_needing_email(integer);

create or replace function public.spd_list_personas_needing_email(
  p_limit integer default 500
)
returns table (
  contact_id     uuid,
  organizer_id   uuid,
  full_name      text,
  first_name     text,
  last_name      text,
  company_name   text,
  company_domain text,
  linkedin_url   text,
  persona_tier   text,
  email_status   text
)
language sql
security definer
set search_path = shootday_partners_discovery, public, pg_temp
as $$
  select
    c.id  as contact_id,
    oc.organizer_id,
    c.full_name,
    coalesce(c.first_name, split_part(c.full_name, ' ', 1))                         as first_name,
    coalesce(c.last_name,  nullif(regexp_replace(c.full_name, '^\S+\s*', ''), ''))  as last_name,
    coalesce(co.name, o.organizer_name)                                             as company_name,
    nullif(regexp_replace(
             regexp_replace(lower(coalesce(co.domain, co.website, o.organizer_website, '')),
                            '^https?://(www\.)?', ''),
             '/.*$', ''), '')                                                       as company_domain,
    c.linkedin_url,
    oc.persona_tier,
    oc.email_status
  from shootday_partners_discovery.organizer_contacts oc
  join public.contacts   c  on c.id = oc.contact_id
  join shootday_partners_discovery.organizers o on o.id = oc.organizer_id
  left join public.companies co on co.id = c.current_company_id
  where coalesce(oc.email_status, '') in ('needs_email', 'review_no_staff_email')
    and not exists (select 1 from public.contact_emails ce where ce.contact_id = c.id)
  order by (oc.persona_tier = 'decision_maker') desc, oc.created_at desc
  limit greatest(coalesce(p_limit, 500), 1);
$$;

revoke execute on function public.spd_list_personas_needing_email(integer) from public, anon, authenticated;
grant execute on function public.spd_list_personas_needing_email(integer) to service_role;
