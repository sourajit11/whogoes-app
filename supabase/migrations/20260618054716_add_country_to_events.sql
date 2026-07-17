-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS country text;

COMMENT ON COLUMN public.events.country IS 'Full country name derived from location/region (e.g. United Kingdom, France, Italy, Spain, United States). NULL when location cannot be classified. Backfilled/maintained by manage_event_status.py.';
