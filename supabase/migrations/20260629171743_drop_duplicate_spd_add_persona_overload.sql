-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- Remove the 16-arg spd_add_persona overload that conflicts with the 17-arg
-- (p_engagement_type) version, causing PostgREST PGRST203 ambiguity. The kept
-- function has p_engagement_type defaulted, so existing callers still resolve.
drop function if exists public.spd_add_persona(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, date
);
