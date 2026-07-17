-- Telemetry for the Moltsets-first enrichment workflows (Phase 4 Contact + Phase 5
-- Mentioned, "MoltSets" variants). One row per contact processed, so we can (a)
-- report daily on Apify-spend reduction and (b) track Moltsets data validity by
-- measuring how often Moltsets emails survive Reoon + Dropleads verification.
--
-- Written OUT-OF-BAND by the n8n workflows via log_enrichment_metric() using the
-- service_role key. Additive + reversible. Read only through SECURITY DEFINER RPCs.

CREATE TABLE IF NOT EXISTS enrichment_metrics (
  id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow                 text NOT NULL,                 -- 'contact' | 'mentioned'
  contact_id               uuid,
  linkedin_url             text,
  profile_source           text,                          -- 'moltsets' | 'apify' | 'cache' | 'none'
  company_source           text,                          -- 'moltsets' | 'apify' | 'none'
  apify_individual_called   boolean NOT NULL DEFAULT false,
  apify_company_called      boolean NOT NULL DEFAULT false,
  moltsets_email_candidate text,
  moltsets_email_verified  boolean NOT NULL DEFAULT false,
  email_source             text,                          -- 'moltsets' | 'dropleads' | 'findymail' | 'none'
  reoon_status             text,
  dropleads_status         text,
  event_role               text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

-- Daily report scans the last 24h by created_at.
CREATE INDEX IF NOT EXISTS idx_enrichment_metrics_created_at
  ON enrichment_metrics (created_at DESC);

ALTER TABLE enrichment_metrics ENABLE ROW LEVEL SECURITY;

-- One insert per processed contact. Nulls allowed so partial branches can still log.
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
  p_event_role               text    DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO enrichment_metrics (
    workflow, contact_id, linkedin_url, profile_source, company_source,
    apify_individual_called, apify_company_called, moltsets_email_candidate,
    moltsets_email_verified, email_source, reoon_status, dropleads_status, event_role
  ) VALUES (
    p_workflow, p_contact_id, p_linkedin_url, p_profile_source, p_company_source,
    coalesce(p_apify_individual_called, false), coalesce(p_apify_company_called, false),
    p_moltsets_email_candidate, coalesce(p_moltsets_email_verified, false),
    p_email_source, p_reoon_status, p_dropleads_status, p_event_role
  )
  RETURNING id;
$$;

-- Aggregates for the daily Slack report. Single row; counts over [p_since, now()).
CREATE OR REPLACE FUNCTION public.get_enrichment_metrics_daily(
  p_since timestamptz DEFAULT (now() - interval '24 hours')
)
RETURNS TABLE (
  total_processed          bigint,
  fully_moltsets           bigint,   -- profile from moltsets AND no apify call at all
  apify_individual_calls   bigint,
  apify_company_calls      bigint,
  moltsets_emails_accepted bigint,   -- moltsets candidate that passed verify and was used
  fell_to_waterfall        bigint,   -- email came from dropleads/findymail
  no_email                 bigint,
  moltsets_email_attempts  bigint,   -- had a moltsets candidate
  moltsets_accept_rate     numeric   -- accepted / attempts, 2dp
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH m AS (
    SELECT * FROM enrichment_metrics WHERE created_at >= p_since
  )
  SELECT
    count(*)                                                                              AS total_processed,
    count(*) FILTER (WHERE profile_source = 'moltsets'
                       AND NOT apify_individual_called
                       AND NOT apify_company_called)                                      AS fully_moltsets,
    count(*) FILTER (WHERE apify_individual_called)                                       AS apify_individual_calls,
    count(*) FILTER (WHERE apify_company_called)                                          AS apify_company_calls,
    count(*) FILTER (WHERE email_source = 'moltsets')                                     AS moltsets_emails_accepted,
    count(*) FILTER (WHERE email_source IN ('dropleads', 'findymail'))                    AS fell_to_waterfall,
    count(*) FILTER (WHERE email_source = 'none' OR email_source IS NULL)                 AS no_email,
    count(*) FILTER (WHERE moltsets_email_candidate IS NOT NULL
                       AND moltsets_email_candidate <> '')                                AS moltsets_email_attempts,
    round(
      count(*) FILTER (WHERE email_source = 'moltsets')::numeric
      / nullif(count(*) FILTER (WHERE moltsets_email_candidate IS NOT NULL
                                  AND moltsets_email_candidate <> ''), 0),
      2)                                                                                  AS moltsets_accept_rate
  FROM m;
$$;

REVOKE ALL ON FUNCTION public.log_enrichment_metric(text, uuid, text, text, text, boolean, boolean, text, boolean, text, text, text, text) FROM public;
REVOKE ALL ON FUNCTION public.get_enrichment_metrics_daily(timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.log_enrichment_metric(text, uuid, text, text, text, boolean, boolean, text, boolean, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_enrichment_metrics_daily(timestamptz) TO service_role;
