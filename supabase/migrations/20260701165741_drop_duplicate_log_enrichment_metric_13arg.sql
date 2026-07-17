-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- Remove the older 13-arg log_enrichment_metric so PostgREST can resolve the call.
-- The 14-arg version (adds p_findymail_status, which the workflow sends) is the superset and is kept.
drop function if exists public.log_enrichment_metric(
  text, uuid, text, text, text, boolean, boolean, text, boolean, text, text, text, text
);
