-- Narrow RPC for daily-lead-extract pipeline.
--
-- Why: get_all_browsable_events aggregates contact counts across all ~344 events
-- (active + inactive, past + future) and filters via HAVING. This was taking 8+
-- seconds and hitting Supabase's default statement_timeout, causing the daily
-- lead extract workflow to fail intermittently.
--
-- This function pre-filters events to active + 7-day-lookahead before aggregating,
-- cutting the workload to ~50 events. Counting logic mirrors get_all_browsable_events
-- exactly (3-hour settled filter, distinct contact_id with non-null contact_emails row),
-- so it produces the same contacts_with_email numbers for any given event.
--
-- The existing get_all_browsable_events function is untouched — the public browse
-- page continues to use it.

CREATE OR REPLACE FUNCTION get_pipeline_qualifying_events(
  p_start_date date,
  p_min_contacts int
)
RETURNS TABLE (
  event_id uuid,
  event_name text,
  event_year int,
  event_region text,
  event_location text,
  event_start_date date,
  is_active boolean,
  total_contacts bigint,
  contacts_with_email bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    e.id,
    e.name,
    e.year,
    e.region,
    e.location,
    e.start_date,
    e.is_active,
    COUNT(DISTINCT CASE
      WHEN COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
      THEN ce.contact_id END) AS total_contacts,
    COUNT(DISTINCT CASE
      WHEN cem.email IS NOT NULL
       AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
      THEN ce.contact_id END) AS contacts_with_email
  FROM events e
  LEFT JOIN contact_events ce ON ce.event_id = e.id
  LEFT JOIN contacts c ON c.id = ce.contact_id
  LEFT JOIN contact_emails cem ON cem.contact_id = ce.contact_id
  WHERE e.is_active = true
    AND e.start_date >= p_start_date
  GROUP BY e.id, e.name, e.year, e.region, e.location, e.start_date, e.is_active
  HAVING COUNT(DISTINCT CASE
      WHEN cem.email IS NOT NULL
       AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
      THEN ce.contact_id END) >= p_min_contacts;
$$;

GRANT EXECUTE ON FUNCTION get_pipeline_qualifying_events(date, int) TO service_role;
