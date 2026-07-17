-- Pulled from remote on 2026-05-15. Originally applied via Supabase Studio.
-- Captured into local migrations for parity (rule: all DDL must be tracked).


-- Add extra enrichment columns
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS headquarters_city text,
  ADD COLUMN IF NOT EXISTS headquarters_country text,
  ADD COLUMN IF NOT EXISTS founded_year integer,
  ADD COLUMN IF NOT EXISTS specialties text,
  ADD COLUMN IF NOT EXISTS company_type text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS employee_count integer,
  ADD COLUMN IF NOT EXISTS follower_count integer;

COMMENT ON COLUMN companies.description IS 'Company description/tagline from LinkedIn';
COMMENT ON COLUMN companies.headquarters_city IS 'HQ city from LinkedIn';
COMMENT ON COLUMN companies.headquarters_country IS 'HQ country from LinkedIn';
COMMENT ON COLUMN companies.founded_year IS 'Year founded';
COMMENT ON COLUMN companies.specialties IS 'Comma-separated specialties from LinkedIn';
COMMENT ON COLUMN companies.company_type IS 'e.g. Public, Private, Nonprofit';
COMMENT ON COLUMN companies.logo_url IS 'Company logo URL from LinkedIn';
COMMENT ON COLUMN companies.employee_count IS 'Exact employee count from LinkedIn';
COMMENT ON COLUMN companies.follower_count IS 'LinkedIn follower count';

-- Update enrich_company RPC to accept extra fields
CREATE OR REPLACE FUNCTION enrich_company(
  p_company_id uuid,
  p_name text DEFAULT NULL,
  p_domain text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_size_range text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_headquarters_city text DEFAULT NULL,
  p_headquarters_country text DEFAULT NULL,
  p_founded_year integer DEFAULT NULL,
  p_specialties text DEFAULT NULL,
  p_company_type text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_employee_count integer DEFAULT NULL,
  p_follower_count integer DEFAULT NULL
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
    description = COALESCE(NULLIF(TRIM(p_description), ''), description),
    headquarters_city = COALESCE(NULLIF(TRIM(p_headquarters_city), ''), headquarters_city),
    headquarters_country = COALESCE(NULLIF(TRIM(p_headquarters_country), ''), headquarters_country),
    founded_year = COALESCE(p_founded_year, founded_year),
    specialties = COALESCE(NULLIF(TRIM(p_specialties), ''), specialties),
    company_type = COALESCE(NULLIF(TRIM(p_company_type), ''), company_type),
    logo_url = COALESCE(NULLIF(TRIM(p_logo_url), ''), logo_url),
    employee_count = COALESCE(p_employee_count, employee_count),
    follower_count = COALESCE(p_follower_count, follower_count),
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
