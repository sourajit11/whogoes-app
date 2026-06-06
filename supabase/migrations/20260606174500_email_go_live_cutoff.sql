-- =====================================================================
-- Email automation: go-live cutoff.
--
-- "Start fresh": the state-based scans (active flow, pre-event, low balance)
-- must only ever consider accounts created AFTER go-live. Existing sign-ups
-- (214 accounts as of 2026-06-06 17:44 UTC) never receive these flows, even
-- if they unlock contacts later. Purchase-triggered emails (paid flow,
-- credits_added) are NOT scans and still fire for everyone going forward.
-- =====================================================================

BEGIN;

-- Single source of truth for the cutoff.
CREATE OR REPLACE FUNCTION email_go_live()
RETURNS timestamptz
LANGUAGE sql IMMUTABLE
AS $$ SELECT TIMESTAMPTZ '2026-06-06 17:45:00+00' $$;

-- Active flow — add created_at cutoff.
CREATE OR REPLACE FUNCTION email_scan_active_flow()
RETURNS TABLE (
  user_id         UUID,
  email           TEXT,
  first_name      TEXT,
  first_unlock_at TIMESTAMPTZ,
  event_id        UUID,
  event_name      TEXT,
  event_slug      TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (cca.user_id)
    cca.user_id,
    u.email::TEXT,
    COALESCE(u.raw_user_meta_data->>'first_name',
             split_part(u.raw_user_meta_data->>'full_name', ' ', 1), '') AS first_name,
    cca.charged_at AS first_unlock_at,
    e.id   AS event_id,
    e.name AS event_name,
    e.slug AS event_slug
  FROM customer_contact_access cca
  JOIN auth.users u ON u.id = cca.user_id
  JOIN events e     ON e.id = cca.event_id
  WHERE u.created_at >= email_go_live()
    AND NOT EXISTS (
      SELECT 1 FROM email_messages m
      WHERE m.user_id = cca.user_id AND m.template_key = 'active_1h'
    )
  ORDER BY cca.user_id, cca.charged_at ASC;
END;
$$;

-- Pre-event — add created_at cutoff.
CREATE OR REPLACE FUNCTION email_scan_pre_event()
RETURNS TABLE (
  user_id         UUID,
  email           TEXT,
  first_name      TEXT,
  event_id        UUID,
  event_name      TEXT,
  event_slug      TEXT,
  start_date      DATE,
  total_contacts  BIGINT,
  unlocked_count  BIGINT,
  balance         INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ces.user_id,
    u.email::TEXT,
    COALESCE(u.raw_user_meta_data->>'first_name',
             split_part(u.raw_user_meta_data->>'full_name', ' ', 1), '') AS first_name,
    e.id   AS event_id,
    e.name AS event_name,
    e.slug AS event_slug,
    e.start_date,
    (SELECT COUNT(DISTINCT c.id)
       FROM contacts c JOIN contact_events ce ON ce.contact_id = c.id
       WHERE ce.event_id = e.id
         AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
    ) AS total_contacts,
    (SELECT COUNT(*) FROM customer_contact_access cca
       WHERE cca.user_id = ces.user_id AND cca.event_id = e.id
    ) AS unlocked_count,
    (COALESCE(us.free_credits, 0) + COALESCE(cu.credits_balance, 0)) AS balance
  FROM customer_event_subscriptions ces
  JOIN auth.users u ON u.id = ces.user_id
  JOIN events e     ON e.id = ces.event_id
  LEFT JOIN user_signups us ON us.user_id = ces.user_id
  LEFT JOIN customers cu     ON cu.user_id = ces.user_id
  WHERE u.created_at >= email_go_live()
    AND e.start_date IS NOT NULL
    AND e.start_date >= CURRENT_DATE
    AND e.start_date <= CURRENT_DATE + 5
    AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.user_id = ces.user_id AND p.status = 'paid')
    AND NOT EXISTS (
      SELECT 1 FROM email_messages m
      WHERE m.template_key = 'pre_event_5d'
        AND m.user_id = ces.user_id
        AND m.payload->>'event_id' = e.id::text
    );
END;
$$;

-- Low balance — add created_at cutoff.
CREATE OR REPLACE FUNCTION email_scan_low_balance()
RETURNS TABLE (
  user_id    UUID,
  email      TEXT,
  first_name TEXT,
  balance    INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.email::TEXT,
    COALESCE(u.raw_user_meta_data->>'first_name',
             split_part(u.raw_user_meta_data->>'full_name', ' ', 1), '') AS first_name,
    (COALESCE(us.free_credits, 0) + COALESCE(cu.credits_balance, 0)) AS balance
  FROM auth.users u
  LEFT JOIN user_signups us ON us.user_id = u.id
  LEFT JOIN customers cu     ON cu.user_id = u.id
  WHERE u.created_at >= email_go_live()
    AND (COALESCE(us.free_credits, 0) + COALESCE(cu.credits_balance, 0)) <= 5
    AND EXISTS (SELECT 1 FROM customer_contact_access cca WHERE cca.user_id = u.id)
    AND NOT EXISTS (
      SELECT 1 FROM email_messages m
      WHERE m.user_id = u.id AND m.template_key = 'low_balance'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION email_go_live() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION email_go_live() TO service_role;

COMMIT;
