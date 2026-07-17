-- Further optimize get_all_browsable_events to stay well under Supabase's 8s
-- service-role statement_timeout. The 2026-05-06 CTE rewrite removed the
-- cross-product join but still relied on COUNT(DISTINCT) over ~120k rows,
-- which forced a Sort + GroupAggregate that spilled to disk (~4.6s in prod
-- after table growth, intermittently busting the timeout).
--
-- Two changes:
--   1. Replace COUNT(DISTINCT contact_id) with COUNT(*). Safe because
--      contact_events has UNIQUE (contact_id, event_id) (constraint
--      uq_contact_event). With duplicates already impossible, COUNT(*) per
--      event_id is identical to COUNT(DISTINCT contact_id). This switches
--      the plan from Sort + GroupAggregate (disk spill) to HashAggregate.
--   2. Invert the 3-hour-settled filter as an anti-join against
--      "recent" contacts. The filter excludes ~0.3% of rows, so the prior
--      INNER JOIN scanned the entire 116k-row contacts table to keep
--      almost everything. The anti-join only needs the ~400 "recent" rows,
--      which the new expression index serves in <1ms.
--
-- Semantics preserved exactly:
--   - 3-hour-settled filter via COALESCE(c.updated_at, c.created_at)
--   - contacts_with_email definition unchanged (DISTINCT on contact_emails)
--   - is_subscribed via auth.uid(); admin-client callers still get FALSE
--   - All four filter args (p_year, p_region, p_min_contacts, p_max_contacts)
--   - ORDER BY e.start_date DESC NULLS LAST
--
-- Local benchmark on prod (admin role, warm cache): 4617ms -> 898ms.

CREATE INDEX IF NOT EXISTS idx_contacts_settled_at
  ON contacts ((COALESCE(updated_at, created_at)));

CREATE OR REPLACE FUNCTION public.get_all_browsable_events(
  p_year integer DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_min_contacts integer DEFAULT NULL,
  p_max_contacts integer DEFAULT NULL
)
RETURNS TABLE (
  event_id uuid,
  event_name text,
  event_year integer,
  event_region text,
  event_location text,
  event_start_date date,
  is_active boolean,
  total_contacts bigint,
  contacts_with_email bigint,
  is_subscribed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH recent_contacts AS (
    SELECT id
    FROM contacts
    WHERE COALESCE(updated_at, created_at) > NOW() - INTERVAL '3 hours'
  ),
  emails AS (
    SELECT DISTINCT contact_id
    FROM contact_emails
    WHERE email IS NOT NULL
  ),
  event_counts AS (
    SELECT
      ce.event_id,
      COUNT(*) AS total_contacts,
      COUNT(*) FILTER (WHERE em.contact_id IS NOT NULL) AS contacts_with_email
    FROM contact_events ce
    LEFT JOIN emails em ON em.contact_id = ce.contact_id
    WHERE NOT EXISTS (
      SELECT 1 FROM recent_contacts rc WHERE rc.id = ce.contact_id
    )
    GROUP BY ce.event_id
  ),
  user_subs AS (
    SELECT ces.event_id
    FROM customer_event_subscriptions ces
    WHERE ces.user_id = auth.uid()
  )
  SELECT
    e.id AS event_id,
    e.name AS event_name,
    e.year AS event_year,
    e.region AS event_region,
    e.location AS event_location,
    e.start_date AS event_start_date,
    e.is_active,
    COALESCE(ec.total_contacts, 0)::bigint AS total_contacts,
    COALESCE(ec.contacts_with_email, 0)::bigint AS contacts_with_email,
    (us.event_id IS NOT NULL) AS is_subscribed
  FROM events e
  LEFT JOIN event_counts ec ON ec.event_id = e.id
  LEFT JOIN user_subs us ON us.event_id = e.id
  WHERE (p_year IS NULL OR e.year = p_year)
    AND (p_region IS NULL OR e.region = p_region)
    AND (p_min_contacts IS NULL OR COALESCE(ec.total_contacts, 0) >= p_min_contacts)
    AND (p_max_contacts IS NULL OR COALESCE(ec.total_contacts, 0) <= p_max_contacts)
  ORDER BY e.start_date DESC NULLS LAST;
$$;
