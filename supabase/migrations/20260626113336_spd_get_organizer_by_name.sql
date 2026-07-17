-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
create or replace function public.spd_get_organizer_by_name(p_name text, p_discovery_track text default null)
returns setof shootday_partners_discovery.organizers
language sql
security definer
set search_path to 'shootday_partners_discovery', 'public', 'pg_temp'
as $function$
  select *
  from shootday_partners_discovery.organizers
  where lower(organizer_name) = lower(p_name)
    and (p_discovery_track is null or discovery_track = p_discovery_track)
    and qualification_status is null;
$function$;
