-- Normalize country at the enrichment write path (root-cause fix for split country buckets).
--
-- contacts.country is populated by the n8n Phase 4 enrichment from raw LinkedIn location
-- strings, so variants like 'UK' vs 'United Kingdom', 'Turkey' vs 'Türkiye', and metro-area
-- strings ('Greater Chicago Area') kept arriving and splitting the My Events country filter.
-- A one-time backfill on 2026-06-23 merged the existing variants; this normalizes new writes
-- so they never re-split. Every enrichment branch (with-email / no-email / WG / cached) funnels
-- through enrich_contact, so wrapping p_country here covers them all.
--
-- To add a new mapping later: extend the CASE in normalize_country via a new migration.

CREATE OR REPLACE FUNCTION public.normalize_country(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT CASE trim(coalesce(p_raw, ''))
    WHEN ''                                  THEN NULL
    WHEN 'UK'                                THEN 'United Kingdom'
    WHEN 'Turkey'                            THEN 'Türkiye'
    WHEN 'Korea, Republic of'                THEN 'South Korea'
    WHEN 'Deutschland'                       THEN 'Germany'
    WHEN 'Hong Kong'                         THEN 'Hong Kong SAR'
    WHEN 'Bahamas'                           THEN 'The Bahamas'
    WHEN 'Moldova, Republic of'              THEN 'Moldova'
    WHEN 'Paris et périphérie'               THEN 'France'
    WHEN 'Nantes et périphérie'              THEN 'France'
    WHEN 'Toulouse et périphérie'            THEN 'France'
    WHEN 'Greater Paris Metropolitan Region' THEN 'France'
    WHEN 'Saint Martin (France)'             THEN 'France'
    WHEN 'Texas Metropolitan Area'           THEN 'United States'
    WHEN 'Denver Metropolitan Area'          THEN 'United States'
    WHEN 'Dallas-Fort Worth Metroplex'       THEN 'United States'
    WHEN 'Atlanta Metropolitan Area'         THEN 'United States'
    WHEN 'Ohio Metropolitan Area'            THEN 'United States'
    WHEN 'New York City Metropolitan Area'   THEN 'United States'
    WHEN 'Greater Wilmington Area'           THEN 'United States'
    WHEN 'Greater St. Louis'                 THEN 'United States'
    WHEN 'Greater Hartford'                  THEN 'United States'
    WHEN 'Greater Chicago Area'              THEN 'United States'
    WHEN 'Greater Madrid Metropolitan Area'  THEN 'Spain'
    WHEN 'Voorst, Gelderland, Netherlands'   THEN 'Netherlands'
    ELSE trim(p_raw)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.enrich_contact(p_contact_id uuid, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_headline text DEFAULT NULL::text, p_current_title text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_company_linkedin_url text DEFAULT NULL::text, p_company_name text DEFAULT NULL::text, p_company_domain text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_email_provider text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_company_id uuid;
  v_email_id uuid;
begin
  -- Step 1: Upsert company if LinkedIn URL provided
  if nullif(trim(p_company_linkedin_url), '') is not null then
    select (public.upsert_company(
      p_linkedin_url := p_company_linkedin_url,
      p_name := p_company_name,
      p_domain := p_company_domain
    ))->>'company_id' into v_company_id;
    v_company_id := v_company_id::uuid;
  end if;

  -- Step 2: Update contact with enriched data
  -- nullif(trim(...), '') converts empty/whitespace strings to null
  -- so coalesce falls through to existing value when Apify returns nothing.
  -- country is run through normalize_country() so spelling/metro-area variants
  -- collapse into one canonical bucket (keeps the My Events country filter clean).
  update public.contacts
  set
    first_name = coalesce(nullif(trim(p_first_name), ''), public.contacts.first_name),
    last_name = coalesce(nullif(trim(p_last_name), ''), public.contacts.last_name),
    headline = coalesce(nullif(trim(p_headline), ''), public.contacts.headline),
    current_title = coalesce(nullif(trim(p_current_title), ''), public.contacts.current_title),
    current_company_id = coalesce(v_company_id, public.contacts.current_company_id),
    city = coalesce(nullif(trim(p_city), ''), public.contacts.city),
    country = coalesce(public.normalize_country(p_country), public.contacts.country),
    is_enriched = true,
    enriched_at = now()
  where id = p_contact_id;

  -- Step 3: Insert email if provided (skip if email already exists globally)
  if nullif(trim(p_email), '') is not null then
    insert into public.contact_emails (contact_id, company_id, email, status, is_primary, provider)
    values (p_contact_id, v_company_id, p_email, 'valid', true, p_email_provider)
    on conflict (email) do nothing
    returning id into v_email_id;

    -- If email already existed, get its ID
    if v_email_id is null then
      select id into v_email_id
      from public.contact_emails
      where email = p_email;
    end if;
  end if;

  return json_build_object(
    'contact_id', p_contact_id,
    'company_id', v_company_id,
    'email_id', v_email_id,
    'enriched', true
  );
end;
$function$;
