-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
alter table shootday_partners_discovery.organizers
  add column if not exists company_id uuid references public.companies(id) on delete set null;

create index if not exists idx_spd_organizers_company
  on shootday_partners_discovery.organizers (company_id);

create table if not exists shootday_partners_discovery.organizer_contacts (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  organizer_id uuid not null references shootday_partners_discovery.organizers(id) on delete cascade,
  contact_id   uuid not null references public.contacts(id) on delete cascade,
  persona_tier text,
  email_status text,
  found_at     date,
  unique (organizer_id, contact_id)
);

create index if not exists idx_spd_orgcontacts_org     on shootday_partners_discovery.organizer_contacts (organizer_id);
create index if not exists idx_spd_orgcontacts_contact on shootday_partners_discovery.organizer_contacts (contact_id);

alter table shootday_partners_discovery.organizer_contacts enable row level security;

comment on table shootday_partners_discovery.organizer_contacts is
  'Links a discovered organizer to its persona contacts (public.contacts) with persona_tier + email_status.';

create or replace function public.spd_resolve_company(
  p_organizer_id        uuid,
  p_company_linkedin_url text,
  p_name                text default null,
  p_domain              text default null,
  p_website             text default null,
  p_industry            text default null,
  p_size_range          text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id  uuid;
  v_is_enriched boolean;
begin
  if nullif(trim(coalesce(p_company_linkedin_url,'')),'') is null then
    return null;
  end if;

  select ((public.upsert_company(
    p_linkedin_url := p_company_linkedin_url,
    p_name         := p_name,
    p_domain       := p_domain,
    p_website      := p_website,
    p_industry     := p_industry,
    p_size_range   := p_size_range
  ))->>'company_id')::uuid into v_company_id;

  if v_company_id is null then
    return null;
  end if;

  select is_enriched into v_is_enriched from public.companies where id = v_company_id;
  if v_is_enriched is distinct from true then
    perform public.enrich_company(
      p_company_id := v_company_id,
      p_name       := p_name,
      p_domain     := p_domain,
      p_website    := p_website,
      p_industry   := p_industry,
      p_size_range := p_size_range
    );
  end if;

  if p_organizer_id is not null then
    update shootday_partners_discovery.organizers
    set company_id = v_company_id, updated_at = now()
    where id = p_organizer_id;
  end if;

  return v_company_id;
end;
$$;

create or replace function public.spd_add_persona(
  p_organizer_id        uuid,
  p_contact_linkedin_url text,
  p_full_name           text,
  p_first_name          text default null,
  p_last_name           text default null,
  p_title               text default null,
  p_city                text default null,
  p_country             text default null,
  p_company_linkedin_url text default null,
  p_company_name        text default null,
  p_company_domain      text default null,
  p_email               text default null,
  p_email_provider      text default null,
  p_persona_tier        text default null,
  p_email_status        text default null,
  p_found_at            date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contact_id uuid;
begin
  if nullif(trim(coalesce(p_contact_linkedin_url,'')),'') is null then
    return null;
  end if;

  select ((public.upsert_contact(
    p_linkedin_url := p_contact_linkedin_url,
    p_full_name    := p_full_name,
    p_source       := 'org_discovery'
  ))->>'contact_id')::uuid into v_contact_id;

  if v_contact_id is null then
    return null;
  end if;

  perform public.enrich_contact(
    p_contact_id          := v_contact_id,
    p_first_name          := p_first_name,
    p_last_name           := p_last_name,
    p_headline            := null,
    p_current_title       := p_title,
    p_city                := p_city,
    p_country             := p_country,
    p_company_linkedin_url := p_company_linkedin_url,
    p_company_name        := p_company_name,
    p_company_domain      := p_company_domain,
    p_email               := nullif(trim(coalesce(p_email,'')),''),
    p_email_provider      := p_email_provider
  );

  insert into shootday_partners_discovery.organizer_contacts as oc
    (organizer_id, contact_id, persona_tier, email_status, found_at)
  values (p_organizer_id, v_contact_id, p_persona_tier, p_email_status, p_found_at)
  on conflict (organizer_id, contact_id) do update set
    persona_tier = coalesce(excluded.persona_tier, oc.persona_tier),
    email_status = coalesce(excluded.email_status, oc.email_status),
    found_at     = coalesce(excluded.found_at, oc.found_at);

  return v_contact_id;
end;
$$;

create or replace function public.spd_list_targets_needing_contacts(
  p_limit integer default 200
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
    and not exists (
      select 1 from shootday_partners_discovery.organizer_contacts oc
      where oc.organizer_id = o.id
    )
  order by o.events_seen_count desc, o.updated_at desc
  limit greatest(coalesce(p_limit,200),1);
$$;

revoke execute on function
  public.spd_resolve_company(uuid,text,text,text,text,text,text),
  public.spd_add_persona(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,date),
  public.spd_list_targets_needing_contacts(integer)
  from public, anon, authenticated;

grant execute on function
  public.spd_resolve_company(uuid,text,text,text,text,text,text),
  public.spd_add_persona(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,date),
  public.spd_list_targets_needing_contacts(integer)
  to service_role;
