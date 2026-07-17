-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
alter table shootday_partners_discovery.organizers
  add column if not exists next_event_subject text;

comment on column shootday_partners_discovery.organizers.next_event_subject is
  'Short (<=3 words), lowercase subject for Variant 1 Step 1; acronym-preferred abbreviation of next_event_name.';

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
begin
  select upcoming_events_detail, distinct_cities
    into v_detail, v_cities
  from shootday_partners_discovery.organizers
  where id = p_id;

  -- next event: soonest in-person, real-city event >= 30 days out
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

  -- city_names_display source: distinct_cities, else fall back to real cities
  -- seen anywhere in upcoming_events_detail (covers orgs with no distinct_cities).
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
    -- build short lowercase subject (<=3 words), prefer acronym + type word
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

drop function if exists public.spd_personas_for_instantly(text, boolean);

create or replace function public.spd_personas_for_instantly(
  p_discovery_track text default null,
  p_only_with_email boolean default true
)
returns table(
  organizer_id uuid, contact_id uuid, discovery_track text, engagement_type text,
  participant_role text, persona_tier text, organizer_name text, organizer_website text,
  full_name text, first_name text, last_name text, title text, linkedin_url text,
  city text, country text, email text, email_status text, email_provider text,
  email_verified_at timestamp with time zone, found_at date,
  campaign_variant text, next_event_name text, next_event_city text,
  next_event_subject text, city_names_display text
)
language sql
security definer
set search_path to 'shootday_partners_discovery', 'public', 'pg_temp'
as $function$
  select
    oc.organizer_id, oc.contact_id, o.discovery_track, oc.engagement_type,
    o.participant_role, oc.persona_tier, o.organizer_name, o.organizer_website,
    c.full_name, c.first_name, c.last_name, c.current_title, c.linkedin_url,
    c.city, c.country, pe.email, pe.status, pe.provider, pe.verified_at, oc.found_at,
    o.campaign_variant, o.next_event_name, o.next_event_city,
    o.next_event_subject, o.city_names_display
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
    and oc.instantly_uploaded_at is null
  order by o.organizer_name, oc.persona_tier, c.full_name;
$function$;

grant execute on function public.spd_personas_for_instantly(text, boolean) to service_role;
