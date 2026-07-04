-- Moltsets-driven company enrichment support (daily /enrich-missing-companies skill).
--
-- Two jobs:
--   1. Contacts with NO company linked -> reverse_linkedin_lookup finds the company,
--      we upsert it and link it (which also fills industry via the bucket trigger).
--   2. Existing companies whose industry is Unknown/blank -> search_companies fills industry.
--
-- Attempt-tracking columns let the daily run advance through the backlog without
-- ever re-hitting the same row (hit or miss), so re-running is cheap and idempotent.
-- All DDL is idempotent so a later `supabase db push` of this file is a safe no-op.

alter table public.contacts  add column if not exists moltsets_company_lookup_at  timestamptz;
alter table public.companies add column if not exists moltsets_industry_lookup_at  timestamptz;

-- Fast selection of the daily batches.
create index if not exists idx_contacts_moltsets_pending
  on public.contacts (created_at desc)
  where current_company_id is null
    and moltsets_company_lookup_at is null
    and linkedin_url is not null;

create index if not exists idx_companies_moltsets_ind_pending
  on public.companies (id)
  where moltsets_industry_lookup_at is null
    and (industry_bucket is null or industry_bucket = 'Other / Unknown');

-- ---------------------------------------------------------------------------
-- Job 1: link the contact to its company. reverse_linkedin_lookup returns a
-- company NAME (and sometimes industry) but rarely a URL, so we dedup by
-- normalized_name against our existing 131k companies first -- most of these
-- contacts' companies are already enriched, we just never linked this contact.
-- Only create a new company when there is no name match. An advisory lock on the
-- normalized name serialises concurrent creates so a batch cannot make dupes.
-- Fills a matched company's industry only when it is currently blank.
-- Propagates to event_contact_facts immediately.
-- ---------------------------------------------------------------------------
create or replace function public.moltsets_link_contact_company(
  p_contact_id      uuid,
  p_company_name    text,
  p_company_url     text,   -- canonical linkedin company url, usually null
  p_domain          text,
  p_industry        text,
  p_contact_title   text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company_id uuid;
  v_norm       text := lower(btrim(regexp_replace(coalesce(p_company_name,''), '\s+', ' ', 'g')));
begin
  if v_norm = '' then
    update public.contacts set moltsets_company_lookup_at = now() where id = p_contact_id;
    return null;
  end if;

  -- strongest match: exact company linkedin url when present
  if p_company_url is not null and btrim(p_company_url) <> '' then
    select id into v_company_id from public.companies
      where normalized_linkedin_url = p_company_url limit 1;
  end if;

  -- otherwise match by normalized name (serialise same-name creates)
  if v_company_id is null then
    perform pg_advisory_xact_lock(hashtext(v_norm));
    select id into v_company_id from public.companies
      where normalized_name = v_norm
      order by is_enriched desc nulls last, updated_at desc nulls last
      limit 1;
  end if;

  if v_company_id is null then
    -- Only create a NEW company when we have a confident linkedin url for it
    -- (companies.linkedin_url is NOT NULL, and a url means the caller cleared the
    -- confidence gate). Otherwise record the attempt and leave the contact Unknown
    -- rather than inventing a company. normalized_linkedin_url is generated.
    if p_company_url is null or btrim(p_company_url) = '' then
      update public.contacts set moltsets_company_lookup_at = now() where id = p_contact_id;
      return null;
    end if;
    insert into public.companies
      (name, normalized_name, linkedin_url, domain, industry, source)
    values
      (p_company_name, v_norm, p_company_url,
       nullif(p_domain,''), nullif(p_industry,''), 'moltsets')
    returning id into v_company_id;
  else
    update public.companies
       set industry = case
                        when industry is null or btrim(industry) = '' or industry in ('Unknown','N/A')
                        then coalesce(nullif(p_industry,''), industry)
                        else industry
                      end,
           domain   = coalesce(domain, nullif(p_domain,'')),
           updated_at = now()
     where id = v_company_id;
  end if;

  update public.contacts
     set current_company_id       = v_company_id,
         current_title            = coalesce(current_title, nullif(p_contact_title,'')),
         moltsets_company_lookup_at = now()
   where id = p_contact_id;

  perform public.refresh_contact_facts(p_contact_id);
  return v_company_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Job 2: set an existing company's industry (bucket trigger re-buckets it),
-- record the attempt, and propagate the new bucket to event_contact_facts.
-- Pass p_industry null on a miss to just record the attempt.
-- ---------------------------------------------------------------------------
create or replace function public.moltsets_set_company_industry(
  p_company_id uuid,
  p_industry   text
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_bucket text;
begin
  if p_industry is null or btrim(p_industry) = '' then
    update public.companies set moltsets_industry_lookup_at = now() where id = p_company_id;
    return null;
  end if;

  update public.companies
     set industry = p_industry,               -- trigger recomputes industry_bucket
         moltsets_industry_lookup_at = now()
   where id = p_company_id
  returning industry_bucket into v_bucket;

  update public.event_contact_facts f
     set industry = v_bucket
    from public.contacts c
   where c.current_company_id = p_company_id
     and f.contact_id = c.id;

  return v_bucket;
end;
$$;
