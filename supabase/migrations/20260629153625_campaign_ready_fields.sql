-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
alter table shootday_partners_discovery.organizers
  add column if not exists campaign_variant   text,
  add column if not exists next_event_name     text,
  add column if not exists next_event_city     text,
  add column if not exists next_event_date      date,
  add column if not exists city_names_display  text;

comment on column shootday_partners_discovery.organizers.campaign_variant is
  'Routing key for outreach: event_led (we know a real upcoming in-person event) or city_led.';
comment on column shootday_partners_discovery.organizers.next_event_name is
  'Clean event name for Variant 1 {next_event}. Null on city_led.';
comment on column shootday_partners_discovery.organizers.next_event_city is
  'Clean in-person city for Variant 1 {next_event_city}; never Online/role. Null on city_led.';
comment on column shootday_partners_discovery.organizers.city_names_display is
  'Formatted city list for Variant 2 {city_names} (suffixes stripped, "A, B and C").';

alter table shootday_partners_discovery.organizer_contacts
  add column if not exists instantly_uploaded_at timestamptz;

comment on column shootday_partners_discovery.organizer_contacts.instantly_uploaded_at is
  'Stamped when the contact has been pushed to an Instantly campaign; gates re-upload.';

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

  v_clean := array(
    select trim(split_part(t.cty, ',', 1))
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

grant execute on function public.spd_derive_campaign_fields(uuid) to service_role;

do $$
declare r record;
begin
  for r in select id from shootday_partners_discovery.organizers where is_target loop
    perform public.spd_derive_campaign_fields(r.id);
  end loop;
end $$;

create or replace function public.spd_mark_contacts_uploaded(p_contact_ids uuid[])
returns integer
language sql
security definer
set search_path to 'shootday_partners_discovery', 'public', 'pg_temp'
as $function$
  with upd as (
    update shootday_partners_discovery.organizer_contacts
       set instantly_uploaded_at = now()
     where contact_id = any(p_contact_ids)
       and instantly_uploaded_at is null
    returning 1
  )
  select count(*)::int from upd;
$function$;

grant execute on function public.spd_mark_contacts_uploaded(uuid[]) to service_role;

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
  campaign_variant text, next_event_name text, next_event_city text, city_names_display text
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
    o.campaign_variant, o.next_event_name, o.next_event_city, o.city_names_display
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
