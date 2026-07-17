-- Raise statement_timeout for the daily-extract pipeline RPC.
--
-- Why: get_pipeline_qualifying_events started timing out again on 2026-04-21
-- cold-cache runs (~9s, Supabase default service-role statement_timeout is ~8s).
-- The 2026-04-19 event-prefilter reduced scope from ~344 to ~50 events, but the
-- LEFT JOIN fan-out over contact_events -> contacts -> contact_emails grows with
-- the contacts table, so the RPC keeps drifting upward.
--
-- Per-function override is cleaner than raising the global role timeout. A
-- follow-up should rewrite the RPC to aggregate per-event via LATERAL subquery
-- so it stays fast as data grows; this unblocks the pipeline in the meantime.

ALTER FUNCTION get_pipeline_qualifying_events(date, int)
  SET statement_timeout = '60s';
