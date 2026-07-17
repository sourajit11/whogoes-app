-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- Cache lookup used by Phase 4 enrichment to avoid re-paying for company
-- enrichment (MoltSets/Apify) when the company is already in our table.
-- Matches by normalized LinkedIn URL first, then by domain, using the same
-- normalization as upsert_company so the cache cannot miss on URL formatting.
create or replace function public.lookup_company(
  p_linkedin_url text default null,
  p_domain text default null
)
returns json
language sql
stable
security definer
set search_path to 'public'
as $function$
  with norm as (
    select
      nullif(trim(coalesce(p_linkedin_url, '')), '') as li,
      nullif(
        regexp_replace(
          regexp_replace(lower(trim(coalesce(p_domain, ''))), '^https?://(www\.)?', ''),
          '/.*$', ''
        ),
      '') as dom
  )
  select json_build_object(
    'company_id',     c.id,
    'is_enriched',    c.is_enriched,
    'linkedin_url',   c.linkedin_url,
    'name',           c.name,
    'domain',         c.domain,
    'employee_count', c.employee_count,
    'size_range',     c.size_range
  )
  from public.companies c, norm n
  where
    (n.li is not null and c.normalized_linkedin_url = public.normalize_linkedin_company_url(n.li))
    or
    (n.dom is not null and lower(c.domain) = n.dom)
  order by
    (case when n.li is not null
          and c.normalized_linkedin_url = public.normalize_linkedin_company_url(n.li)
          then 0 else 1 end),
    (case when c.is_enriched then 0 else 1 end),
    c.enriched_at desc nulls last
  limit 1;
$function$;

grant execute on function public.lookup_company(text, text) to service_role;
