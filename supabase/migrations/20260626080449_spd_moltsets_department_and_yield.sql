-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
alter table shootday_partners_discovery.moltsets_search_cursor
  add column if not exists department text;

comment on column shootday_partners_discovery.moltsets_search_cursor.department is
  'MoltSets department/functional_area filter for this cell (e.g. Marketing). NULL = no department filter.';

drop function if exists public.spd_seed_search_cells(text[],text[],text[]);

create or replace function public.spd_seed_search_cells(
  p_industries  text[],
  p_keywords    text[],
  p_seniorities text[] default array[null]::text[],
  p_department  text   default null
)
returns integer
language plpgsql
security definer
set search_path = shootday_partners_discovery, public, pg_temp
as $$
declare
  v_inserted integer := 0;
  v_dept text := nullif(btrim(coalesce(p_department,'')),'');
  v_ind text;
  v_kw  text;
  v_sen text;
begin
  foreach v_ind in array p_industries loop
    foreach v_kw in array p_keywords loop
      foreach v_sen in array coalesce(p_seniorities, array[null]::text[]) loop
        insert into shootday_partners_discovery.moltsets_search_cursor
          (cell_key, industry, keyword, seniority, department)
        values (
          concat_ws('|', v_ind, v_kw, coalesce(v_sen,''), coalesce(v_dept,'')),
          v_ind, v_kw, nullif(v_sen,''), v_dept
        )
        on conflict (cell_key) do nothing;
        if found then v_inserted := v_inserted + 1; end if;
      end loop;
    end loop;
  end loop;
  return v_inserted;
end;
$$;

create or replace function public.spd_moltsets_industry_yield()
returns table(
  industry          text,
  seeded            bigint,
  evaluated         bigint,
  qualified         bigint,
  targets           bigint,
  with_target_event bigint,
  personas_done     bigint
)
language sql
security definer
set search_path = shootday_partners_discovery, public, pg_temp
as $$
  select
    coalesce(o.industries, '(none)')                                  as industry,
    count(*)                                                          as seeded,
    count(*) filter (where o.qualification_status is not null)        as evaluated,
    count(*) filter (where o.qualification_status = 'qualified')      as qualified,
    count(*) filter (where o.is_target is true)                       as targets,
    count(*) filter (where o.is_next_event_found is true)             as with_target_event,
    count(*) filter (where o.contacts_status = 'processed')           as personas_done
  from shootday_partners_discovery.organizers o
  where o.discovery_track = 'moltsets_us'
  group by coalesce(o.industries, '(none)')
  order by count(*) filter (where o.is_target is true) desc, count(*) desc;
$$;

revoke execute on function
  public.spd_seed_search_cells(text[],text[],text[],text),
  public.spd_moltsets_industry_yield()
  from public, anon, authenticated;

grant execute on function
  public.spd_seed_search_cells(text[],text[],text[],text),
  public.spd_moltsets_industry_yield()
  to service_role;
