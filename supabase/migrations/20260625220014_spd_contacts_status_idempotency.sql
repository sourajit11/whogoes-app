-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
alter table shootday_partners_discovery.organizers
  add column if not exists contacts_status     text,
  add column if not exists contacts_fetched_at timestamptz;

comment on column shootday_partners_discovery.organizers.contacts_status is
  'Contact Finder attempt marker. NULL = not yet attempted (eligible). ''processed'' = attempted (won''t be re-pulled). Reset to NULL to retry an org.';

drop function if exists public.spd_resolve_company(uuid,text,text,text,text,text,text);

create or replace function public.spd_resolve_company(
  p_organizer_id        uuid,
  p_company_linkedin_url text,
  p_name                text default null,
  p_domain              text default null,
  p_website             text default null,
  p_industry            text default null,
  p_size_range          text default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id  uuid;
  v_is_enriched boolean;
begin
  if p_organizer_id is not null then
    update shootday_partners_discovery.organizers
    set contacts_status     = 'processed',
        contacts_fetched_at = now(),
        updated_at          = now()
    where id = p_organizer_id;
  end if;

  if nullif(trim(coalesce(p_company_linkedin_url,'')),'') is null then
    return json_build_object('company_id', null, 'skipped', 'no_company_linkedin_url');
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
    return json_build_object('company_id', null);
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

  return json_build_object('company_id', v_company_id);
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
    and o.contacts_status is null
  order by o.events_seen_count desc, o.updated_at desc
  limit greatest(coalesce(p_limit,200),1);
$$;

update shootday_partners_discovery.organizers o
set contacts_status     = 'processed',
    contacts_fetched_at = now()
where o.qualification_status = 'qualified'
  and o.is_target is true
  and o.contacts_status is null;

revoke execute on function
  public.spd_resolve_company(uuid,text,text,text,text,text,text),
  public.spd_list_targets_needing_contacts(integer)
  from public, anon, authenticated;

grant execute on function
  public.spd_resolve_company(uuid,text,text,text,text,text,text),
  public.spd_list_targets_needing_contacts(integer)
  to service_role;
