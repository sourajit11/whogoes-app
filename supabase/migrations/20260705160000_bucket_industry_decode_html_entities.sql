-- Root-cause fix for the recurring '&amp;' industry gaps.
--
-- bucket_company_industry() matches the raw industry string against
-- company_industry_bucket_map by exact (lower/btrim) equality. Enrichment sources
-- sometimes deliver HTML-entity-encoded ampersands, so 'Food &amp; Beverages'
-- never equals the seeded 'Food & Beverage' and falls to 'Other / Unknown' on
-- every enrich — /audit-company-industries kept re-mapping the same encoded
-- variants each run. Decode the common ampersand entities before the lookup so a
-- whole class of these resolve without teaching each encoded variant by hand.
--
-- Only the lookup key is decoded; companies.industry keeps its raw value (no longer
-- customer-visible now that filters/preview render the bucket).

create or replace function public.bucket_company_industry(p_raw text)
returns text language sql immutable as $$
  with normalized as (
    select nullif(btrim(
      replace(replace(replace(coalesce(p_raw,''), '&amp;amp;', '&'), '&amp;', '&'), '&#38;', '&')
    ), '') as v
  )
  select case
    when (select v from normalized) is null then null
    else coalesce(
      (select m.bucket from public.company_industry_bucket_map m
       where lower(m.raw_industry) = lower((select v from normalized)) limit 1),
      'Other / Unknown')
  end;
$$;
