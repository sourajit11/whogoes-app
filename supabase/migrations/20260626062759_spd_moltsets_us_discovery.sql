-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- ============================================================================
-- Migration: MoltSets-first US discovery track (persona-seeded partner finder)
-- Date: 2026-06-26
-- ============================================================================

-- 1. Organizer columns: company LinkedIn (known at seed time) + multi-city verdict.
alter table shootday_partners_discovery.organizers
  add column if not exists company_linkedin_url text,
  add column if not exists is_multi_city        boolean,
  add column if not exists distinct_cities       text[];

comment on column shootday_partners_discovery.organizers.company_linkedin_url is
  'LinkedIn company URL captured at seed time (moltsets_us track) or resolved later.';
comment on column shootday_partners_discovery.organizers.is_multi_city is
  'Qualifier verdict: company hosts events across multiple cities (hard partner criterion).';
comment on column shootday_partners_discovery.organizers.distinct_cities is
  'Distinct event cities the qualifier found for this company.';

-- 2. Coverage ledger for the partitioned national crawl.
create table if not exists shootday_partners_discovery.moltsets_search_cursor (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  cell_key        text not null unique,
  industry        text not null,
  keyword         text not null,
  seniority       text,
  last_offset     integer not null default 0,
  exhausted       boolean not null default false,
  results_seen    integer not null default 0,
  companies_found integer not null default 0,
  last_run_at     timestamptz
);

comment on table shootday_partners_discovery.moltsets_search_cursor is
  'Resumable coverage ledger for the MoltSets US persona crawl. Partition: industry x keyword x seniority. exhausted=true when a cell is fully paginated.';

create index if not exists idx_spd_cursor_pending
  on shootday_partners_discovery.moltsets_search_cursor (exhausted, last_run_at nulls first);

alter table shootday_partners_discovery.moltsets_search_cursor enable row level security;

-- 3. Seed one company as a moltsets_us organizer.
create or replace function public.spd_upsert_moltsets_target(
  p_company_name         text,
  p_company_linkedin_url text default null,
  p_company_website      text default null,
  p_company_industry     text default null,
  p_country              text default null
)
returns json
language plpgsql
security definer
set search_path = shootday_partners_discovery, public, pg_temp
as $$
declare
  v_norm text := lower(btrim(coalesce(p_company_name,'')));
  v_row  shootday_partners_discovery.organizers;
  v_is_new boolean;
begin
  if v_norm = '' then
    return json_build_object('organizer_id', null, 'skipped', 'no_company_name');
  end if;

  insert into shootday_partners_discovery.organizers as o (
    source, discovery_track, normalized_name, organizer_name,
    organizer_website, company_linkedin_url, industries,
    countries_seen
  ) values (
    'moltsets', 'moltsets_us', v_norm, p_company_name,
    nullif(trim(coalesce(p_company_website,'')),''),
    nullif(trim(coalesce(p_company_linkedin_url,'')),''),
    nullif(trim(coalesce(p_company_industry,'')),''),
    case when nullif(trim(coalesce(p_country,'')),'') is null
         then '{}'::text[] else array[p_country] end
  )
  on conflict (normalized_name) do update set
    organizer_website    = coalesce(o.organizer_website, excluded.organizer_website),
    company_linkedin_url = coalesce(o.company_linkedin_url, excluded.company_linkedin_url),
    industries           = coalesce(o.industries, excluded.industries),
    countries_seen       = (select array(select distinct e
                                          from unnest(o.countries_seen || excluded.countries_seen) e
                                          where e is not null and e <> '')),
    updated_at           = now()
  returning o.* into v_row;

  v_is_new := (v_row.created_at = v_row.updated_at);

  return json_build_object('organizer_id', v_row.id, 'is_new', v_is_new);
end;
$$;

-- 4a. Seed (or top up) the crawl grid.
create or replace function public.spd_seed_search_cells(
  p_industries  text[],
  p_keywords    text[],
  p_seniorities text[] default array[null]::text[]
)
returns integer
language plpgsql
security definer
set search_path = shootday_partners_discovery, public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_ind text;
  v_kw  text;
  v_sen text;
begin
  foreach v_ind in array p_industries loop
    foreach v_kw in array p_keywords loop
      foreach v_sen in array coalesce(p_seniorities, array[null]::text[]) loop
        insert into shootday_partners_discovery.moltsets_search_cursor
          (cell_key, industry, keyword, seniority)
        values (
          concat_ws('|', v_ind, v_kw, coalesce(v_sen,'')),
          v_ind, v_kw, nullif(v_sen,'')
        )
        on conflict (cell_key) do nothing;
        if found then v_inserted := v_inserted + 1; end if;
      end loop;
    end loop;
  end loop;
  return v_inserted;
end;
$$;

-- 4b. Next cells to crawl.
create or replace function public.spd_next_search_cells(
  p_limit integer default 20
)
returns setof shootday_partners_discovery.moltsets_search_cursor
language sql
security definer
set search_path = shootday_partners_discovery, public, pg_temp
as $$
  select *
  from shootday_partners_discovery.moltsets_search_cursor
  where exhausted is not true
  order by last_run_at asc nulls first, cell_key
  limit greatest(coalesce(p_limit,20),1);
$$;

-- 4c. Checkpoint a cell.
create or replace function public.spd_record_search_cell(
  p_cell_key        text,
  p_last_offset     integer,
  p_exhausted       boolean default false,
  p_results_seen    integer default 0,
  p_companies_found integer default 0
)
returns json
language plpgsql
security definer
set search_path = shootday_partners_discovery, public, pg_temp
as $$
declare
  v_row shootday_partners_discovery.moltsets_search_cursor;
begin
  update shootday_partners_discovery.moltsets_search_cursor set
    last_offset     = greatest(coalesce(p_last_offset, last_offset), 0),
    exhausted       = coalesce(p_exhausted, exhausted),
    results_seen    = results_seen + greatest(coalesce(p_results_seen,0),0),
    companies_found = companies_found + greatest(coalesce(p_companies_found,0),0),
    last_run_at     = now(),
    updated_at      = now()
  where cell_key = p_cell_key
  returning * into v_row;

  if v_row.id is null then
    raise exception 'search cell % not found', p_cell_key;
  end if;
  return json_build_object('cell_key', v_row.cell_key, 'last_offset', v_row.last_offset, 'exhausted', v_row.exhausted);
end;
$$;

-- 4d. Results consumed today (15k/day budget gate).
create or replace function public.spd_search_results_today()
returns integer
language sql
security definer
set search_path = shootday_partners_discovery, public, pg_temp
as $$
  select coalesce(sum(results_seen), 0)::integer
  from shootday_partners_discovery.moltsets_search_cursor
  where last_run_at::date = current_date;
$$;

-- 5. Extend spd_set_organizer_qualification with is_multi_city + distinct_cities.
drop function if exists public.spd_set_organizer_qualification(uuid,text,text,text,text,boolean,text,integer,integer,text,text,boolean,jsonb);

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
  p_upcoming_events      jsonb   default null,
  p_is_multi_city        boolean default null,
  p_distinct_cities      text[]  default null
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
    industries             = coalesce(p_industries, industries),
    next_qualified_event   = p_next_qualified_event,
    is_next_event_found    = p_is_next_event_found,
    upcoming_events_detail = p_upcoming_events,
    is_multi_city          = coalesce(p_is_multi_city, is_multi_city),
    distinct_cities        = coalesce(p_distinct_cities, distinct_cities),
    updated_at             = now()
  where id = p_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'organizer % not found', p_id;
  end if;
  return v_row;
end;
$$;

-- 6. spd_list_targets_needing_contacts: optional discovery_track filter.
drop function if exists public.spd_list_targets_needing_contacts(integer);

create or replace function public.spd_list_targets_needing_contacts(
  p_limit           integer default 200,
  p_discovery_track text default null
)
returns setof shootday_partners_discovery.organizers
language sql
security definer
set search_path = shootday_partners_discovery, public, pg_temp
as $$
  select o.*
  from shootday_partners_discovery.organizers o
  where o.qualification_status = 'qualified'
    and o.is_target is true
    and o.contacts_status is null
    and (p_discovery_track is null or o.discovery_track = p_discovery_track)
  order by o.events_seen_count desc, o.updated_at desc
  limit greatest(coalesce(p_limit,200),1);
$$;

-- 7. Grants.
revoke execute on function
  public.spd_upsert_moltsets_target(text,text,text,text,text),
  public.spd_seed_search_cells(text[],text[],text[]),
  public.spd_next_search_cells(integer),
  public.spd_record_search_cell(text,integer,boolean,integer,integer),
  public.spd_search_results_today(),
  public.spd_set_organizer_qualification(uuid,text,text,text,text,boolean,text,integer,integer,text,text,boolean,jsonb,boolean,text[]),
  public.spd_list_targets_needing_contacts(integer,text)
  from public, anon, authenticated;

grant execute on function
  public.spd_upsert_moltsets_target(text,text,text,text,text),
  public.spd_seed_search_cells(text[],text[],text[]),
  public.spd_next_search_cells(integer),
  public.spd_record_search_cell(text,integer,boolean,integer,integer),
  public.spd_search_results_today(),
  public.spd_set_organizer_qualification(uuid,text,text,text,text,boolean,text,integer,integer,text,text,boolean,jsonb,boolean,text[]),
  public.spd_list_targets_needing_contacts(integer,text)
  to service_role;
