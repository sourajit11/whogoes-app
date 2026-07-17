-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- Scoped-test helper: fetch organizers by name regardless of qualification_status.
-- Used to re-run Stage C qualifier on a labeled ground-truth set (incl. already-disqualified rows).
CREATE OR REPLACE FUNCTION public.spd_list_organizers_by_names_any(
  p_names text[],
  p_discovery_track text DEFAULT NULL::text
)
RETURNS SETOF shootday_partners_discovery.organizers
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'shootday_partners_discovery', 'public', 'pg_temp'
AS $function$
  select *
  from shootday_partners_discovery.organizers
  where lower(organizer_name) = ANY (
          select lower(trim(n)) from unnest(p_names) AS n
        )
    and (p_discovery_track is null or discovery_track = p_discovery_track)
  order by industries, organizer_name;
$function$;
