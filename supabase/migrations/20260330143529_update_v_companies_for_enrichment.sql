-- Pulled from remote on 2026-05-15. Originally applied via Supabase Studio.
-- Captured into local migrations for parity (rule: all DDL must be tracked).


CREATE OR REPLACE VIEW v_companies_for_enrichment AS
SELECT id, linkedin_url, name, domain, website, industry, size_range
FROM companies
WHERE is_enriched = false
  AND linkedin_url IS NOT NULL
  AND linkedin_url NOT LIKE 'placeholder-%'
  AND (domain IS NULL OR domain = '')
  AND (website IS NULL OR website = '')
  AND (industry IS NULL OR industry = '')
  AND (size_range IS NULL OR size_range = '')
ORDER BY created_at ASC;
