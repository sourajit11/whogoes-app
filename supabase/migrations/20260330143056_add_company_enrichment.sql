-- Pulled from remote on 2026-05-15. Originally applied via Supabase Studio.
-- Captured into local migrations for parity (rule: all DDL must be tracked).


-- 1. Add enrichment tracking columns
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS is_enriched boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz;

-- Partial index for fast view queries
CREATE INDEX IF NOT EXISTS idx_companies_is_enriched
  ON companies (is_enriched) WHERE is_enriched = false;

-- 2. View: unenriched companies
CREATE OR REPLACE VIEW v_companies_for_enrichment AS
SELECT id, linkedin_url, name, domain, website, industry, size_range
FROM companies
WHERE is_enriched = false
  AND linkedin_url IS NOT NULL
  AND linkedin_url NOT LIKE 'placeholder-%'
ORDER BY created_at ASC;

-- 3. RPC: enrich a company (fill nulls, never overwrite)
CREATE OR REPLACE FUNCTION enrich_company(
  p_company_id uuid,
  p_name text DEFAULT NULL,
  p_domain text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_size_range text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  UPDATE companies
  SET
    name = COALESCE(NULLIF(TRIM(p_name), ''), name),
    domain = COALESCE(NULLIF(TRIM(p_domain), ''), domain),
    website = COALESCE(NULLIF(TRIM(p_website), ''), website),
    industry = COALESCE(NULLIF(TRIM(p_industry), ''), industry),
    size_range = COALESCE(NULLIF(TRIM(p_size_range), ''), size_range),
    is_enriched = true,
    enriched_at = now(),
    updated_at = now()
  WHERE id = p_company_id
  RETURNING jsonb_build_object(
    'company_id', id,
    'name', name,
    'domain', domain,
    'is_enriched', is_enriched
  ) INTO v_result;

  RETURN COALESCE(v_result, jsonb_build_object('company_id', p_company_id, 'error', 'not_found'));
END;
$$;
