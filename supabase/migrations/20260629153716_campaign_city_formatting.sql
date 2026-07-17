-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
create or replace function public.spd_derive_campaign_fields(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'shootday_partners_discovery', 'public', 'pg_temp'
as $function$
declare
  v_detail   jsonb;
  v_cities   text[];
  v_pick     jsonb;
  v_city_disp text;
  v_clean    text[];
begin
  select upcoming_events_detail, distinct_cities
    into v_detail, v_cities
  from shootday_partners_discovery.organizers
  where id = p_id;

  select e into v_pick
  from jsonb_array_elements(coalesce(v_detail, '[]'::jsonb)) as e
  where (e->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
    and (e->>'date')::date >= current_date + 30
    and coalesce(e->>'format','') <> 'virtual'
    and coalesce(nullif(trim(e->>'city'),''),'') <> ''
    and lower(trim(e->>'city')) not in ('online','host','exhibitor','sponsor','attendee','tbd')
    and (e->>'city') !~* '^online'
  order by (e->>'date')::date asc
  limit 1;

  -- city_names_display: take city portion, strip ", Country"/" STATE", Title Case, first 3.
  v_clean := array(
    select initcap(
             regexp_replace(trim(split_part(t.cty, ',', 1)), '\s+[A-Z]{2}$', '')
           )
    from unnest(coalesce(v_cities, '{}'::text[])) with ordinality as t(cty, ord)
    where trim(coalesce(t.cty,'')) <> ''
    order by t.ord
    limit 3
  );
  v_city_disp := case
    when array_length(v_clean,1) is null then null
    when array_length(v_clean,1) = 1 then v_clean[1]
    when array_length(v_clean,1) = 2 then v_clean[1] || ' and ' || v_clean[2]
    else array_to_string(v_clean[1:array_length(v_clean,1)-1], ', ')
         || ' and ' || v_clean[array_length(v_clean,1)]
  end;

  if v_pick is not null then
    update shootday_partners_discovery.organizers
       set campaign_variant   = 'event_led',
           next_event_name    = trim(v_pick->>'name'),
           next_event_city    = trim(v_pick->>'city'),
           next_event_date    = (v_pick->>'date')::date,
           city_names_display = v_city_disp
     where id = p_id;
  else
    update shootday_partners_discovery.organizers
       set campaign_variant   = 'city_led',
           next_event_name    = null,
           next_event_city    = null,
           next_event_date    = null,
           city_names_display = v_city_disp
     where id = p_id;
  end if;
end;
$function$;

do $$
declare r record;
begin
  for r in select id from shootday_partners_discovery.organizers where is_target loop
    perform public.spd_derive_campaign_fields(r.id);
  end loop;
end $$;
