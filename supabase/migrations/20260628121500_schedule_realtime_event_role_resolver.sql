-- Schedule the real-time role resolver (gated: only after the resolver in
-- 20260628121000 was verified on a test event). Runs every 3 minutes, draining
-- up to 50 dirty events per tick. The nightly resolve_active_event_roles(3)
-- (02:30) and the 2h refresh_all_event_facets stay as a backstop.
SELECT cron.schedule(
  'resolve-dirty-event-roles',
  '*/3 * * * *',
  $$SELECT public.resolve_dirty_events(50);$$
);
