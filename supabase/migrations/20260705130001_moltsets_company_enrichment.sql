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
-- Job 1: link the contact to its company using the EXACT company LinkedIn URL
-- as the sole identity -- no name guessing. The caller only invokes this when
-- reverse_linkedin_lookup returned the company's own linkedin url, so the match
-- is authoritative. Dedup on normalized_linkedin_url (advisory lock serialises
-- concurrent inserts of the same company). Fills industry only when blank.
-- Propagates to event_contact_facts immediately. No url => no write.
-- ---------------------------------------------------------------------------
create or replace function public.moltsets_link_contact_company(
  p_contact_id      uuid,
  p_company_name    text,
  p_company_url     text,   -- REQUIRED canonical linkedin company url (the identity)
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
  -- Require the exact company linkedin url. Without it we never guess a company.
  if p_company_url is null or btrim(p_company_url) = '' then
    update public.contacts set moltsets_company_lookup_at = now() where id = p_contact_id;
    return null;
  end if;

  -- Serialise same-company inserts, then dedup on the exact url.
  perform pg_advisory_xact_lock(hashtext(p_company_url));
  select id into v_company_id from public.companies
    where normalized_linkedin_url = p_company_url limit 1;

  if v_company_id is null then
    -- normalized_linkedin_url is a generated column; do not set it.
    insert into public.companies
      (name, normalized_name, linkedin_url, domain, industry, source)
    values
      (p_company_name, nullif(v_norm,''), p_company_url,
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
