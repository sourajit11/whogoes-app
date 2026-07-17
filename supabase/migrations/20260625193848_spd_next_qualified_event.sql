-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
alter table shootday_partners_discovery.organizers
  rename column next_event to next_qualified_event;

alter table shootday_partners_discovery.organizers
  add column if not exists is_next_event_found boolean;

comment on column shootday_partners_discovery.organizers.next_qualified_event is
  'Soonest upcoming event >= 30 days out (name | date | city). Empty when none.';
comment on column shootday_partners_discovery.organizers.is_next_event_found is
  'True when a qualified upcoming event (>= 30 days out) exists; drives campaign split.';

update shootday_partners_discovery.organizers o
set next_qualified_event = coalesce(q.label, ''),
    is_next_event_found  = (q.label is not null)
from (
  select org.id,
    (
      select concat_ws(' | ', nullif(e->>'name',''), nullif(e->>'date',''), nullif(e->>'city',''))
      from jsonb_array_elements(org.upcoming_events_detail) with ordinality as t(e, ord)
      where e->>'one_month_plus' = 'yes'
      order by ord
      limit 1
    ) as label
  from shootday_partners_discovery.organizers org
  where org.upcoming_events_detail is not null
) q
where o.id = q.id;

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
  p_next_qualified_event text    default null,
  p_is_next_event_found  boolean default null,
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
    next_qualified_event   = p_next_qualified_event,
    is_next_event_found    = p_is_next_event_found,
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
  public.spd_set_organizer_qualification(uuid,text,text,text,text,boolean,text,integer,integer,text,text,boolean,jsonb)
  from public, anon, authenticated;

grant execute on function
  public.spd_set_organizer_qualification(uuid,text,text,text,text,boolean,text,integer,integer,text,text,boolean,jsonb)
  to service_role;
