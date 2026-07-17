-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- Fix: the jsonb event list collided with the existing integer `upcoming_events`
-- column. Store it in a distinct column instead.
alter table shootday_partners_discovery.organizers
  add column if not exists upcoming_events_detail jsonb;

comment on column shootday_partners_discovery.organizers.upcoming_events_detail is
  'Model-extracted upcoming events for a qualified target (jsonb array), soonest first.';
comment on column shootday_partners_discovery.organizers.upcoming_events is
  'Max upcoming-events count reported by the discovery source (integer).';

drop function if exists public.spd_set_organizer_qualification(uuid,text,text,text,text,boolean,text,integer,integer,text,text,jsonb);

create or replace function public.spd_set_organizer_qualification(
  p_id                   uuid,
  p_qualification_status text,
  p_fit_tier             text    default null,
  p_org_type             text    default null,
  p_photo_video_fit      text    default null,
  p_is_target            boolean default null,
  p_reason               text    default null,
  p_organized_count      integer default null,
  p_sponsored_count      integer default null,
  p_industries           text    default null,
  p_next_event           text    default null,
  p_upcoming_events      jsonb   default null
)
returns shootday_partners_discovery.organizers
language plpgsql
security definer
set search_path = shootday_partners_discovery, public, pg_temp
as $$
declare
  v_row shootday_partners_discovery.organizers;
begin
  update shootday_partners_discovery.organizers set
    qualification_status   = p_qualification_status,
    fit_tier               = p_fit_tier,
    org_type               = p_org_type,
    photo_video_fit        = p_photo_video_fit,
    is_target              = p_is_target,
    reason                 = p_reason,
    organized_count        = p_organized_count,
    sponsored_count        = p_sponsored_count,
    industries             = p_industries,
    next_event             = p_next_event,
    upcoming_events_detail = p_upcoming_events,
    updated_at             = now()
  where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'organizer % not found', p_id;
  end if;
  return v_row;
end;
$$;

revoke execute on function
  public.spd_set_organizer_qualification(uuid,text,text,text,text,boolean,text,integer,integer,text,text,jsonb)
  from public, anon, authenticated;

grant execute on function
  public.spd_set_organizer_qualification(uuid,text,text,text,text,boolean,text,integer,integer,text,text,jsonb)
  to service_role;
