-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
create schema if not exists shootday_partners_discovery;

create table if not exists shootday_partners_discovery.raw_events (
  id                        uuid primary key default gen_random_uuid(),
  created_at                timestamptz not null default now(),
  source                    text not null default '10times',
  event_id                  text,
  event_name                text,
  start_date                date,
  city                      text,
  country                   text,
  event_type                text,
  organizer_name            text,
  organizer_url             text,
  organizer_website         text,
  organizer_total_events    integer default 0,
  organizer_upcoming_events integer default 0,
  unique (source, event_id)
);

comment on table shootday_partners_discovery.raw_events is
  'Append-only log of events scraped from discovery sources (10times etc.). Deduped on (source, event_id).';

create table if not exists shootday_partners_discovery.organizers (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  source              text not null default '10times',
  discovery_track     text not null default 'event_organizer',
  normalized_name     text not null unique,
  organizer_name      text not null,
  organizer_url       text,
  organizer_website   text,
  total_events        integer not null default 0,
  upcoming_events     integer not null default 0,
  events_seen_count   integer not null default 0,
  cities_seen         text[]  not null default '{}',
  countries_seen      text[]  not null default '{}',
  event_types_seen    text[]  not null default '{}',
  sample_event_names  text[]  not null default '{}',
  qualification_status text,
  fit_tier             text,
  org_type             text,
  photo_video_fit      text,
  is_target            boolean,
  reason               text
);

comment on table shootday_partners_discovery.organizers is
  'Deduped discovered companies (event organizers + partner candidates). Natural key: normalized_name. source tags origin (10times/apollo/...), discovery_track separates campaigns.';

create index if not exists idx_spd_organizers_track   on shootday_partners_discovery.organizers (discovery_track);
create index if not exists idx_spd_organizers_source  on shootday_partners_discovery.organizers (source);
create index if not exists idx_spd_organizers_qstatus on shootday_partners_discovery.organizers (qualification_status);
create index if not exists idx_spd_organizers_target  on shootday_partners_discovery.organizers (is_target);

alter table shootday_partners_discovery.raw_events enable row level security;
alter table shootday_partners_discovery.organizers enable row level security;

create or replace function public.spd_insert_raw_event(
  p_source                    text,
  p_event_id                  text,
  p_event_name                text,
  p_start_date                date,
  p_city                      text,
  p_country                   text,
  p_event_type                text,
  p_organizer_name            text,
  p_organizer_url             text,
  p_organizer_website         text,
  p_organizer_total_events    integer,
  p_organizer_upcoming_events integer
)
returns uuid
language plpgsql
security definer
set search_path = shootday_partners_discovery, public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into shootday_partners_discovery.raw_events (
    source, event_id, event_name, start_date, city, country, event_type,
    organizer_name, organizer_url, organizer_website,
    organizer_total_events, organizer_upcoming_events
  ) values (
    coalesce(nullif(p_source,''),'10times'), nullif(p_event_id,''), p_event_name, p_start_date,
    p_city, p_country, p_event_type, p_organizer_name, nullif(p_organizer_url,''),
    nullif(p_organizer_website,''), coalesce(p_organizer_total_events,0), coalesce(p_organizer_upcoming_events,0)
  )
  on conflict (source, event_id) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.spd_upsert_organizer(
  p_organizer_name     text,
  p_organizer_url      text  default null,
  p_organizer_website  text  default null,
  p_total_events       integer default 0,
  p_upcoming_events    integer default 0,
  p_cities             text[] default '{}',
  p_countries          text[] default '{}',
  p_event_types        text[] default '{}',
  p_sample_event_names text[] default '{}',
  p_events_increment   integer default 0,
  p_source             text  default '10times',
  p_discovery_track    text  default 'event_organizer'
)
returns shootday_partners_discovery.organizers
language plpgsql
security definer
set search_path = shootday_partners_discovery, public, pg_temp
as $$
declare
  v_norm text := lower(btrim(p_organizer_name));
  v_row  shootday_partners_discovery.organizers;
begin
  if v_norm is null or v_norm = '' then
    raise exception 'organizer_name is required';
  end if;

  insert into shootday_partners_discovery.organizers as o (
    source, discovery_track, normalized_name, organizer_name, organizer_url, organizer_website,
    total_events, upcoming_events, events_seen_count,
    cities_seen, countries_seen, event_types_seen, sample_event_names
  ) values (
    coalesce(nullif(p_source,''),'10times'), coalesce(nullif(p_discovery_track,''),'event_organizer'),
    v_norm, p_organizer_name, nullif(p_organizer_url,''), nullif(p_organizer_website,''),
    coalesce(p_total_events,0), coalesce(p_upcoming_events,0), greatest(coalesce(p_events_increment,0),0),
    coalesce(p_cities,'{}'), coalesce(p_countries,'{}'), coalesce(p_event_types,'{}'), coalesce(p_sample_event_names,'{}')
  )
  on conflict (normalized_name) do update set
    organizer_url      = coalesce(o.organizer_url, excluded.organizer_url),
    organizer_website  = coalesce(o.organizer_website, excluded.organizer_website),
    total_events       = greatest(o.total_events, excluded.total_events),
    upcoming_events    = greatest(o.upcoming_events, excluded.upcoming_events),
    events_seen_count  = o.events_seen_count + greatest(coalesce(p_events_increment,0),0),
    cities_seen        = (select array(select distinct e from unnest(o.cities_seen || excluded.cities_seen) e where e is not null and e <> '')),
    countries_seen     = (select array(select distinct e from unnest(o.countries_seen || excluded.countries_seen) e where e is not null and e <> '')),
    event_types_seen   = (select array(select distinct e from unnest(o.event_types_seen || excluded.event_types_seen) e where e is not null and e <> '')),
    sample_event_names = (select array(select distinct e from unnest(o.sample_event_names || excluded.sample_event_names) e where e is not null and e <> '')),
    updated_at         = now()
  returning o.* into v_row;
  return v_row;
end;
$$;

create or replace function public.spd_list_organizers_pending_qualification(
  p_limit integer default 50,
  p_discovery_track text default null
)
returns setof shootday_partners_discovery.organizers
language sql
security definer
set search_path = shootday_partners_discovery, public, pg_temp
as $$
  select *
  from shootday_partners_discovery.organizers
  where qualification_status is null
    and (p_discovery_track is null or discovery_track = p_discovery_track)
  order by events_seen_count desc, updated_at desc
  limit greatest(coalesce(p_limit,50),1);
$$;

create or replace function public.spd_set_organizer_qualification(
  p_id                  uuid,
  p_qualification_status text,
  p_fit_tier            text default null,
  p_org_type            text default null,
  p_photo_video_fit     text default null,
  p_is_target           boolean default null,
  p_reason              text default null
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
    qualification_status = p_qualification_status,
    fit_tier             = p_fit_tier,
    org_type             = p_org_type,
    photo_video_fit      = p_photo_video_fit,
    is_target            = p_is_target,
    reason               = p_reason,
    updated_at           = now()
  where id = p_id
  returning * into v_row;
  if v_row.id is null then
    raise exception 'organizer % not found', p_id;
  end if;
  return v_row;
end;
$$;

revoke execute on function
  public.spd_insert_raw_event(text,text,text,date,text,text,text,text,text,text,integer,integer),
  public.spd_upsert_organizer(text,text,text,integer,integer,text[],text[],text[],text[],integer,text,text),
  public.spd_list_organizers_pending_qualification(integer,text),
  public.spd_set_organizer_qualification(uuid,text,text,text,text,boolean,text)
  from public, anon, authenticated;

grant execute on function
  public.spd_insert_raw_event(text,text,text,date,text,text,text,text,text,text,integer,integer),
  public.spd_upsert_organizer(text,text,text,integer,integer,text[],text[],text[],text[],integer,text,text),
  public.spd_list_organizers_pending_qualification(integer,text),
  public.spd_set_organizer_qualification(uuid,text,text,text,text,boolean,text)
  to service_role;
