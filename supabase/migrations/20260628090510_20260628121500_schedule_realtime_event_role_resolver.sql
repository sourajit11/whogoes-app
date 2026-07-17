-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
SELECT cron.schedule(
  'resolve-dirty-event-roles',
  '*/3 * * * *',
  $$SELECT public.resolve_dirty_events(50);$$
);
