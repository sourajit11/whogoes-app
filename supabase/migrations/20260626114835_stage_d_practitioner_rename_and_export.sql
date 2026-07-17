-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- 1. Rename persona tier label 'marketer' -> 'practitioner' (clearer for host companies too)
update shootday_partners_discovery.organizer_contacts
set persona_tier = 'practitioner'
where persona_tier = 'marketer';

-- 2. Self-labeled export for Instantly upload: filter by discovery_track so the
--    MoltSets list and the 10times (event_organizer) list never mix.
create or replace function public.spd_personas_for_instantly(
  p_discovery_track text default null,
  p_only_with_email boolean default true
)
returns table(
  organizer_id uuid,
  contact_id uuid,
  discovery_track text,
  engagement_type text,
  participant_role text,
  persona_tier text,
  organizer_name text,
  organizer_website text,
  full_name text,
  first_name text,
  last_name text,
  title text,
  linkedin_url text,
  city text,
  country text,
  email text,
  email_status text,
  email_provider text,
  email_verified_at timestamptz,
  found_at date
)
language sql
security definer
set search_path to 'shootday_partners_discovery', 'public', 'pg_temp'
as $function$
  select
    oc.organizer_id,
    oc.contact_id,
    o.discovery_track,
    oc.engagement_type,
    o.participant_role,
    oc.persona_tier,
    o.organizer_name,
    o.organizer_website,
    c.full_name,
    c.first_name,
    c.last_name,
    c.current_title,
    c.linkedin_url,
    c.city,
    c.country,
    pe.email,
    pe.status,
    pe.provider,
    pe.verified_at,
    oc.found_at
  from shootday_partners_discovery.organizer_contacts oc
  join shootday_partners_discovery.organizers o on o.id = oc.organizer_id
  join public.contacts c on c.id = oc.contact_id
  left join lateral (
    select email, status, provider, verified_at
    from public.contact_emails
    where contact_id = c.id and invalidated_at is null
    order by is_primary desc, verified_at desc nulls last, created_at desc
    limit 1
  ) pe on true
  where (p_discovery_track is null or o.discovery_track = p_discovery_track)
    and (p_only_with_email is false or pe.email is not null)
  order by o.organizer_name, oc.persona_tier, c.full_name;
$function$;

-- 3. By-name target fetch (for the scoped 2-company Stage D validation run)
create or replace function public.spd_list_targets_by_names(
  p_names text[],
  p_discovery_track text default null
)
returns setof shootday_partners_discovery.organizers
language sql
security definer
set search_path to 'shootday_partners_discovery', 'public', 'pg_temp'
as $function$
  select o.*
  from shootday_partners_discovery.organizers o
  where o.qualification_status = 'qualified'
    and o.is_target is true
    and lower(o.organizer_name) = any (select lower(unnest(p_names)))
    and (p_discovery_track is null or o.discovery_track = p_discovery_track)
  order by o.organizer_name;
$function$;
