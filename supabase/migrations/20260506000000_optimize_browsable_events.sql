-- Optimize get_all_browsable_events to eliminate cold-cache statement_timeout.
--
-- Problem: the previous implementation joined events x contact_events x contacts
-- x contact_emails directly, then collapsed the resulting cross-product with
-- COUNT(DISTINCT CASE ...). As contact_events and contact_emails grew, the
-- cross-product row count exploded and the function flirted with Supabase's
-- ~8s service-role statement_timeout. The browse pages would intermittently
-- error with "We couldn't load the latest events" whenever the unstable_cache
-- entry expired and a visitor triggered a cold revalidate.
--
-- Fix: rewrite as three CTE passes, one per base table, then hash-join those
-- pre-aggregated rows back into events. No row inflation, no DISTINCT-in-COUNT.
-- Function signature, return columns, and semantics are preserved exactly so
-- every existing caller (browse pages, admin scripts) is unaffected.
--
-- Semantics preserved:
--   - 3-hour-settled filter via COALESCE(c.updated_at, c.created_at)
--   - contacts_with_email counts contacts with at least one non-null email
--     (matches the original `cem.email IS NOT NULL` check, no is_primary,
--     no `email != ''` check)
--   - is_subscribed via auth.uid(); admin-client callers get FALSE as before
--   - Filters p_year, p_region, p_min_contacts, p_max_contacts unchanged
--   - ORDER BY e.start_date DESC NULLS LAST unchanged

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
  WITH settled AS (
    SELECT ce.event_id, ce.contact_id
    FROM contact_events ce
    JOIN contacts c ON c.id = ce.contact_id
    WHERE COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
  ),
  emails AS (
    SELECT DISTINCT contact_id
    FROM contact_emails
    WHERE email IS NOT NULL
  ),
  event_counts AS (
    SELECT
      s.event_id,
      COUNT(DISTINCT s.contact_id) AS total_contacts,
      COUNT(DISTINCT s.contact_id) FILTER (WHERE em.contact_id IS NOT NULL) AS contacts_with_email
    FROM settled s
    LEFT JOIN emails em ON em.contact_id = s.contact_id
    GROUP BY s.event_id
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

-- Supporting indexes. CREATE INDEX IF NOT EXISTS is idempotent so this is safe
-- to re-run.
CREATE INDEX IF NOT EXISTS idx_contact_events_event_id
  ON contact_events (event_id);

CREATE INDEX IF NOT EXISTS idx_contact_events_contact_id
  ON contact_events (contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_emails_contact_id
  ON contact_emails (contact_id);
