-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- Read-only helper for conservative sampling of the Stage C qualifier.
-- Returns up to N pending organizers per industry (same SETOF organizers shape
-- as spd_list_organizers_pending_qualification, so downstream nodes are unchanged).
create or replace function public.spd_list_organizers_sample_by_industry(
  p_per_industry integer default 5,
  p_discovery_track text default null
)
returns setof shootday_partners_discovery.organizers
language sql
security definer
set search_path to 'shootday_partners_discovery', 'public', 'pg_temp'
as $function$
  select *
  from shootday_partners_discovery.organizers
  where id in (
    select id from (
      select id,
             row_number() over (
               partition by industries
               order by events_seen_count desc, id
             ) as rn
      from shootday_partners_discovery.organizers
      where qualification_status is null
        and (p_discovery_track is null or discovery_track = p_discovery_track)
        and (coalesce(organizer_website,'') <> '' or coalesce(company_linkedin_url,'') <> '')
    ) ranked
    where ranked.rn <= greatest(coalesce(p_per_industry, 5), 1)
  )
  order by industries, events_seen_count desc, id;
$function$;
