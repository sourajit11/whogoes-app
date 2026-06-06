-- =====================================================================
-- Internal Email Automation (replaces Loops.so)
--
-- Adds a self-hosted email queue + log, an unsubscribe/suppression list,
-- and the read-only RPCs the queue processor uses to render activity-aware
-- emails and to scan for state-based sends (active flow, pre-event, low
-- balance). All processing is keyed by an explicit user id because the job
-- runs with the service role and has no auth.uid().
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- PART 1: Tables
-- ---------------------------------------------------------------------

-- Queue + log. A pending row with a future scheduled_for is a wait timer;
-- a unique dedupe_key makes one-time sends idempotent.
CREATE TABLE email_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  template_key  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | sent | skipped | failed | cancelled
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key    TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_messages_due ON email_messages (status, scheduled_for);
CREATE INDEX idx_email_messages_user ON email_messages (user_id);

-- Recipients who replied STOP or were unsubscribed from the admin panel.
CREATE TABLE email_suppressions (
  email      TEXT PRIMARY KEY,
  reason     TEXT NOT NULL DEFAULT 'stop_reply', -- stop_reply | admin | bounce
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS on, no policies: anon/authenticated get nothing. The service role
-- (used by the processor + admin code) bypasses RLS.
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;

GRANT ALL ON email_messages TO service_role;
GRANT ALL ON email_suppressions TO service_role;

-- ---------------------------------------------------------------------
-- PART 2: Read RPC — live context for rendering an email
-- ---------------------------------------------------------------------
-- Mirrors get_event_unlock_status / get_subscribed_events but keyed by an
-- explicit user id so the service-role processor can call it.
CREATE OR REPLACE FUNCTION get_user_email_context(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_free INTEGER;
  v_paid INTEGER;
  v_is_paid BOOLEAN;
  v_events JSON;
  v_total_unlocked INTEGER;
  v_first_unlock TIMESTAMPTZ;
BEGIN
  SELECT COALESCE(free_credits, 0) INTO v_free FROM user_signups WHERE user_id = p_user_id;
  v_free := COALESCE(v_free, 0);

  SELECT COALESCE(credits_balance, 0) INTO v_paid FROM customers WHERE user_id = p_user_id;
  v_paid := COALESCE(v_paid, 0);

  SELECT EXISTS(
    SELECT 1 FROM payments WHERE user_id = p_user_id AND status = 'paid'
  ) INTO v_is_paid;

  SELECT COUNT(*), MIN(charged_at)
  INTO v_total_unlocked, v_first_unlock
  FROM customer_contact_access WHERE user_id = p_user_id;

  SELECT COALESCE(json_agg(row_to_json(ev) ORDER BY ev.start_date ASC NULLS LAST), '[]'::json)
  INTO v_events
  FROM (
    SELECT
      e.id   AS event_id,
      e.name AS name,
      e.slug AS slug,
      e.start_date AS start_date,
      (e.start_date - CURRENT_DATE) AS days_until,
      (SELECT COUNT(DISTINCT c.id)
         FROM contacts c
         JOIN contact_events ce ON ce.contact_id = c.id
         WHERE ce.event_id = e.id
           AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
      ) AS total_contacts,
      (SELECT COUNT(*)
         FROM customer_contact_access cca
         WHERE cca.user_id = p_user_id AND cca.event_id = e.id
      ) AS unlocked_count
    FROM customer_event_subscriptions ces
    JOIN events e ON e.id = ces.event_id
    WHERE ces.user_id = p_user_id
  ) ev;

  RETURN json_build_object(
    'balance', v_free + v_paid,
    'free_credits', v_free,
    'paid_credits', v_paid,
    'is_paid', v_is_paid,
    'total_unlocked', COALESCE(v_total_unlocked, 0),
    'first_unlock_at', v_first_unlock,
    'event_count', (SELECT COUNT(*) FROM customer_event_subscriptions WHERE user_id = p_user_id),
    'events', v_events
  );
END;
$$;

-- ---------------------------------------------------------------------
-- PART 3: Read RPC — match a signup email to a scraped prospect's event
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION find_prospect_event_for_email(p_email TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_name TEXT;
  v_slug TEXT;
  v_start DATE;
BEGIN
  SELECT e.id, e.name, e.slug, e.start_date
  INTO v_id, v_name, v_slug, v_start
  FROM contact_emails em
  JOIN contacts c       ON c.id = em.contact_id
  JOIN contact_events ce ON ce.contact_id = c.id
  JOIN events e         ON e.id = ce.event_id
  WHERE lower(em.email) = lower(p_email)
  ORDER BY
    (e.start_date >= CURRENT_DATE) DESC,                                  -- upcoming events first
    CASE WHEN e.start_date >= CURRENT_DATE THEN e.start_date END ASC,     -- soonest upcoming
    e.start_date DESC NULLS LAST                                          -- else most recent past
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN json_build_object('matched', false);
  END IF;

  RETURN json_build_object(
    'matched', true,
    'event_id', v_id,
    'event_name', v_name,
    'event_slug', v_slug,
    'start_date', v_start
  );
END;
$$;

-- ---------------------------------------------------------------------
-- PART 4: Scan RPCs — find users who need a state-based email enqueued
-- ---------------------------------------------------------------------

-- Users whose first-ever unlock has no active_1h email yet (Flow B).
-- Returns the first-unlock time + the event of that first unlock.
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
  WHERE NOT EXISTS (
    SELECT 1 FROM email_messages m
    WHERE m.user_id = cca.user_id AND m.template_key = 'active_1h'
  )
  ORDER BY cca.user_id, cca.charged_at ASC;
END;
$$;

-- Free (non-paying) users with a subscribed event starting within 5 days
-- that has no pre_event_5d email yet (Flow D).
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
  WHERE e.start_date IS NOT NULL
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

-- Active users whose balance fell to/below 5 and who have no low_balance
-- email yet (improvement #5).
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
  WHERE (COALESCE(us.free_credits, 0) + COALESCE(cu.credits_balance, 0)) <= 5
    AND EXISTS (SELECT 1 FROM customer_contact_access cca WHERE cca.user_id = u.id)
    AND NOT EXISTS (
      SELECT 1 FROM email_messages m
      WHERE m.user_id = u.id AND m.template_key = 'low_balance'
    );
END;
$$;

-- These all take/return cross-user data, so keep them off the public API.
REVOKE EXECUTE ON FUNCTION get_user_email_context(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION find_prospect_event_for_email(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION email_scan_active_flow() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION email_scan_pre_event() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION email_scan_low_balance() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION get_user_email_context(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION find_prospect_event_for_email(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION email_scan_active_flow() TO service_role;
GRANT EXECUTE ON FUNCTION email_scan_pre_event() TO service_role;
GRANT EXECUTE ON FUNCTION email_scan_low_balance() TO service_role;

COMMIT;
