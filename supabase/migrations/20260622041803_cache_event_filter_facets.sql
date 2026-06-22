-- The default (unfiltered) ICP breakdown shown on every event page was recomputed live
-- on each load via get_event_filter_facets({}). On large events (e.g. Viva Technology,
-- 10,088 contacts) that is ~4s warm / ~10s cold and stalls "Counting matches...".
-- It is the same for everyone until the data changes, so we cache it on the events row
-- and refresh it in the background. Live recompute now only runs when a visitor applies
-- an actual filter.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS facets_cache jsonb,
  ADD COLUMN IF NOT EXISTS facets_cached_at timestamptz;

-- Recompute and store the unfiltered facets for one event.
CREATE OR REPLACE FUNCTION public.refresh_event_facets(p_event_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  UPDATE public.events
  SET facets_cache = public.get_event_filter_facets(p_event_id, '{}'::jsonb),
      facets_cached_at = now()
  WHERE id = p_event_id;
$$;

-- Batch refresh. p_days => null refreshes every event (nightly full pass, also picks up
-- role-resolution changes). p_days => N refreshes only events with contact_events linked in
-- the last N days, plus any event that has never been cached.
CREATE OR REPLACE FUNCTION public.refresh_all_event_facets(p_days integer DEFAULT 2)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event uuid;
  v_n int := 0;
BEGIN
  FOR v_event IN
    SELECT e.id
    FROM events e
    WHERE e.facets_cache IS NULL
       OR p_days IS NULL
       OR EXISTS (
         SELECT 1 FROM contact_events ce
         WHERE ce.event_id = e.id
           AND ce.created_at >= now() - make_interval(days => p_days)
       )
  LOOP
    PERFORM public.refresh_event_facets(v_event);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_event_facets(uuid) FROM public;
REVOKE ALL ON FUNCTION public.refresh_all_event_facets(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.refresh_event_facets(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_all_event_facets(integer) TO service_role;

-- Every 2 hours: refresh the actively-changing events (touched in the last 2 days) + any
-- uncached event. Keeps big live events fresh without recomputing all ~600 every run.
SELECT cron.schedule(
  'refresh-event-facets',
  '15 */2 * * *',
  $cron$ SELECT public.refresh_all_event_facets(2); $cron$
);

-- Nightly full pass at 03:00 UTC (after role resolution at 02:30) so role changes flow into
-- the cached breakdown for every event.
SELECT cron.schedule(
  'refresh-event-facets-nightly',
  '0 3 * * *',
  $cron$ SELECT public.refresh_all_event_facets(NULL); $cron$
);
