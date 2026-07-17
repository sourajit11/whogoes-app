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
  v_name     text;
  v_tokens   text[];
  v_acr      text;
  v_type     text;
  v_sig      text[];
  v_subject  text;
  v_allowed  text[] := array[
    'usa','united states','us','united states of america','u.s.','u.s.a.','america',
    'canada','uk','united kingdom','great britain','britain','england','scotland','wales',
    'northern ireland','ireland','germany','france','spain','italy','netherlands',
    'the netherlands','belgium','luxembourg','austria','switzerland','sweden','denmark',
    'norway','finland','iceland','poland','portugal','czechia','czech republic','greece',
    'hungary','romania','bulgaria','croatia','slovakia','slovenia','estonia','latvia',
    'lithuania','malta','cyprus','singapore','australia'];
begin
  select upcoming_events_detail, distinct_cities
    into v_detail, v_cities
  from shootday_partners_discovery.organizers
  where id = p_id;

  -- next event: soonest in-person, real-city, ALLOWED-REGION event >= 30 days out
  select e into v_pick
  from jsonb_array_elements(coalesce(v_detail, '[]'::jsonb)) as e
  where (e->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
    and (e->>'date')::date >= current_date + 30
    and coalesce(e->>'format','') <> 'virtual'
    and coalesce(nullif(trim(e->>'city'),''),'') <> ''
    and lower(trim(e->>'city')) not in ('online','host','exhibitor','sponsor','attendee','tbd')
    and (e->>'city') !~* '^online'
    and (
      e->>'country' is null or btrim(e->>'country') = ''
      or lower(btrim(e->>'country')) = any(v_allowed)
    )
  order by (e->>'date')::date asc
  limit 1;

  if coalesce(array_length(v_cities,1),0) = 0 then
    v_cities := array(
      select distinct on (lower(trim(split_part(e->>'city',',',1))))
             trim(e->>'city')
      from jsonb_array_elements(coalesce(v_detail,'[]'::jsonb)) e
      where coalesce(nullif(trim(e->>'city'),''),'') <> ''
        and lower(trim(e->>'city')) not in ('online','host','exhibitor','sponsor','attendee','tbd')
        and (e->>'city') !~* '^online'
    );
  end if;

  v_clean := array(
    select initcap(regexp_replace(trim(split_part(t.cty, ',', 1)), '\s+[A-Z]{2}$', ''))
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
    v_name   := trim(v_pick->>'name');
    v_tokens := regexp_split_to_array(v_name, '\s+');
    select t into v_acr from unnest(v_tokens) t where t ~ '^[A-Z]{2,6}$' limit 1;
    select lower(regexp_replace(t,'[^a-zA-Z]','','g')) into v_type
      from unnest(v_tokens) t
      where lower(regexp_replace(t,'[^a-zA-Z]','','g')) in
        ('conference','summit','expo','exposition','convention','forum','congress',
         'symposium','festival','fair','show','tradeshow','meeting','workshop',
         'bootcamp','retreat','gala','awards','conclave','convening','assembly')
      limit 1;
    v_sig := array(
      select lower(regexp_replace(t,'[^a-zA-Z0-9]','','g'))
      from unnest(v_tokens) with ordinality s(t,o)
      where lower(regexp_replace(t,'[^a-zA-Z0-9]','','g')) not in
        ('the','a','an','of','on','and','for','in','at','to','with','by','its',
         'annual','national','international','global','regional','world','us','usa','')
      order by o
    );
    if v_acr is not null and v_type is not null and lower(v_acr) <> v_type then
      v_subject := lower(v_acr) || ' ' || v_type;
    elsif v_acr is not null then
      v_subject := lower(v_acr)
        || coalesce(' ' || (select x from unnest(v_sig) x where x <> lower(v_acr) limit 1), '');
    else
      v_subject := array_to_string(v_sig[1:3], ' ');
    end if;
    v_subject := nullif(array_to_string((regexp_split_to_array(trim(v_subject),'\s+'))[1:3], ' '), '');

    update shootday_partners_discovery.organizers
       set campaign_variant   = 'event_led',
           next_event_name    = v_name,
           next_event_city    = trim(v_pick->>'city'),
           next_event_date    = (v_pick->>'date')::date,
           next_event_subject = v_subject,
           city_names_display = v_city_disp
     where id = p_id;
  else
    update shootday_partners_discovery.organizers
       set campaign_variant   = 'city_led',
           next_event_name    = null,
           next_event_city    = null,
           next_event_date    = null,
           next_event_subject = null,
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
