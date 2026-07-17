-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
alter table shootday_partners_discovery.organizer_contacts
  add column if not exists icp_fit_score numeric,
  add column if not exists icp_reason text;

comment on column shootday_partners_discovery.organizer_contacts.icp_fit_score is
  'Gemini ICP fit score (0-100) at selection time.';
comment on column shootday_partners_discovery.organizer_contacts.icp_reason is
  'Gemini one-line rationale for selecting this contact.';

-- replace the single (17-arg) overload with a 19-arg version that also stores ICP fields.
drop function if exists public.spd_add_persona(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, date, text
);

create or replace function public.spd_add_persona(
  p_organizer_id uuid,
  p_contact_linkedin_url text,
  p_full_name text,
  p_first_name text default null,
  p_last_name text default null,
  p_title text default null,
  p_city text default null,
  p_country text default null,
  p_company_linkedin_url text default null,
  p_company_name text default null,
  p_company_domain text default null,
  p_email text default null,
  p_email_provider text default null,
  p_persona_tier text default null,
  p_email_status text default null,
  p_found_at date default null,
  p_engagement_type text default null,
  p_icp_fit_score numeric default null,
  p_icp_reason text default null
)
returns json
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_contact_id uuid;
begin
  if nullif(trim(coalesce(p_contact_linkedin_url,'')),'') is null then
    return json_build_object('contact_id', null, 'skipped', 'no_contact_linkedin_url');
  end if;

  select ((public.upsert_contact(
    p_linkedin_url := p_contact_linkedin_url,
    p_full_name    := p_full_name,
    p_source       := 'org_discovery'
  ))->>'contact_id')::uuid into v_contact_id;

  if v_contact_id is null then
    return json_build_object('contact_id', null, 'skipped', 'unresolved_contact');
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
    (organizer_id, contact_id, persona_tier, email_status, found_at, engagement_type, icp_fit_score, icp_reason)
  values (p_organizer_id, v_contact_id, p_persona_tier, p_email_status, p_found_at, p_engagement_type, p_icp_fit_score, p_icp_reason)
  on conflict (organizer_id, contact_id) do update set
    persona_tier    = coalesce(excluded.persona_tier, oc.persona_tier),
    email_status    = coalesce(excluded.email_status, oc.email_status),
    found_at        = coalesce(excluded.found_at, oc.found_at),
    engagement_type = coalesce(excluded.engagement_type, oc.engagement_type),
    icp_fit_score   = coalesce(excluded.icp_fit_score, oc.icp_fit_score),
    icp_reason      = coalesce(excluded.icp_reason, oc.icp_reason);

  return json_build_object('contact_id', v_contact_id);
end;
$function$;

grant execute on function public.spd_add_persona(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, date, text, numeric, text
) to service_role;
