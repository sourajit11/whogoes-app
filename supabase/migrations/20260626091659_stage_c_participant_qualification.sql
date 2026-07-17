-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- Expand Stage C qualification to cover event PARTICIPANTS (exhibitors/sponsors),
-- not just hosts. Tag each org's engagement type so messaging can branch.
alter table shootday_partners_discovery.organizers
  add column if not exists engagement_type text,
  add column if not exists participant_role text;

comment on column shootday_partners_discovery.organizers.engagement_type is
  'How the org engages with events: host | participant | both. Drives outreach messaging. Null = not qualified on either path.';
comment on column shootday_partners_discovery.organizers.participant_role is
  'Strongest observed participation signal: exhibitor | sponsor | attendee | none.';

-- Replace the qualification writer to also persist engagement_type + participant_role.
drop function if exists public.spd_set_organizer_qualification(uuid, text, text, text, boolean, text, integer, integer, text, text, boolean, jsonb, boolean, text[]);

create or replace function public.spd_set_organizer_qualification(
  p_id uuid,
  p_qualification_status text,
  p_fit_tier text default null,
  p_org_type text default null,
  p_is_target boolean default null,
  p_reason text default null,
  p_organized_count integer default null,
  p_sponsored_count integer default null,
  p_industries text default null,
  p_next_qualified_event text default null,
  p_is_next_event_found boolean default null,
  p_upcoming_events jsonb default null,
  p_is_multi_city boolean default null,
  p_distinct_cities text[] default null,
  p_engagement_type text default null,
  p_participant_role text default null
)
returns shootday_partners_discovery.organizers
language plpgsql
security definer
set search_path to 'shootday_partners_discovery', 'public', 'pg_temp'
as $function$
declare
  v_row shootday_partners_discovery.organizers;
begin
  update shootday_partners_discovery.organizers set
    qualification_status   = p_qualification_status,
    fit_tier               = p_fit_tier,
    org_type               = p_org_type,
    is_target              = p_is_target,
    reason                 = p_reason,
    organized_count        = p_organized_count,
    sponsored_count        = p_sponsored_count,
    industries             = coalesce(p_industries, industries),
    next_qualified_event   = p_next_qualified_event,
    is_next_event_found    = p_is_next_event_found,
    upcoming_events_detail = p_upcoming_events,
    is_multi_city          = coalesce(p_is_multi_city, is_multi_city),
    distinct_cities        = coalesce(p_distinct_cities, distinct_cities),
    engagement_type        = p_engagement_type,
    participant_role       = p_participant_role,
    updated_at             = now()
  where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'organizer % not found', p_id;
  end if;
  return v_row;
end;
$function$;
