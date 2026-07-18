-- ============================================
-- WhoGoes Public API V1 — fast events list
-- Run AFTER 10-api-keys.sql.
--
-- The dashboard's get_all_browsable_events does heavy DISTINCT counts and
-- LATERAL email joins per row, which can cross statement_timeout on cold
-- cache (we hit this in V1 smoke testing). For the public API we use a
-- single GROUP BY subquery — much faster and bounded by an index on
-- contact_events.event_id.
--
-- Design notes:
--   - We INTENTIONALLY drop `contacts_with_email` and `is_subscribed` from
--     the list response. Both belong on GET /events/:id/status, which is
--     already fast.
--   - Counts here use raw contact_events rows (no settled-row filter).
--     Total is a discovery hint, not transactional. Settled-row filter
--     stays where it matters: status, unlock, get-unlocked.
-- ============================================

CREATE OR REPLACE FUNCTION api_list_events()
RETURNS TABLE (
  event_id UUID,
  event_name TEXT,
  event_slug TEXT,
  event_year INTEGER,
  event_region TEXT,
  event_location TEXT,
  event_start_date DATE,
  is_active BOOLEAN,
  total_contacts BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH counts AS (
    SELECT event_id, COUNT(*)::bigint AS total_contacts
    FROM contact_events
    GROUP BY event_id
  )
  SELECT
    e.id AS event_id,
    e.name AS event_name,
    e.slug AS event_slug,
    e.year AS event_year,
    e.region AS event_region,
    e.location AS event_location,
    e.start_date AS event_start_date,
    e.is_active,
    COALESCE(c.total_contacts, 0) AS total_contacts
  FROM events e
  LEFT JOIN counts c ON c.event_id = e.id
  WHERE e.is_active = true
  ORDER BY e.start_date DESC NULLS LAST;
$$;

-- Helpful index if it doesn't already exist
CREATE INDEX IF NOT EXISTS idx_contact_events_event_id ON contact_events (event_id);
