-- Track the Findymail catch-all verification verdict in enrichment telemetry.
-- The Moltsets email gate now does Reoon (power) and, for catch-all results,
-- Findymail /api/verify. p_findymail_status is appended (with default) so the
-- existing Log Metric callers that omit it stay valid via PostgREST.

ALTER TABLE enrichment_metrics ADD COLUMN IF NOT EXISTS findymail_status text;

CREATE OR REPLACE FUNCTION public.log_enrichment_metric(
  p_workflow                 text,
  p_contact_id               uuid    DEFAULT NULL,
  p_linkedin_url             text    DEFAULT NULL,
  p_profile_source           text    DEFAULT NULL,
  p_company_source           text    DEFAULT NULL,
  p_apify_individual_called  boolean DEFAULT false,
  p_apify_company_called     boolean DEFAULT false,
  p_moltsets_email_candidate text    DEFAULT NULL,
  p_moltsets_email_verified  boolean DEFAULT false,
  p_email_source             text    DEFAULT NULL,
  p_reoon_status             text    DEFAULT NULL,
  p_dropleads_status         text    DEFAULT NULL,
  p_event_role               text    DEFAULT NULL,
  p_findymail_status         text    DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO enrichment_metrics (
    workflow, contact_id, linkedin_url, profile_source, company_source,
    apify_individual_called, apify_company_called, moltsets_email_candidate,
    moltsets_email_verified, email_source, reoon_status, dropleads_status, event_role,
    findymail_status
  ) VALUES (
    p_workflow, p_contact_id, p_linkedin_url, p_profile_source, p_company_source,
    coalesce(p_apify_individual_called, false), coalesce(p_apify_company_called, false),
    p_moltsets_email_candidate, coalesce(p_moltsets_email_verified, false),
    p_email_source, p_reoon_status, p_dropleads_status, p_event_role,
    p_findymail_status
  )
  RETURNING id;
$$;

GRANT EXECUTE ON FUNCTION public.log_enrichment_metric(text, uuid, text, text, text, boolean, boolean, text, boolean, text, text, text, text, text) TO service_role;
