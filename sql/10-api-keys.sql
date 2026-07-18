-- ============================================
-- WhoGoes Public API V1 — Tables, RPCs, Paid Gating
-- Run in Supabase SQL Editor AFTER 02-unlock-rpcs.sql and 04-event-slugs.sql.
--
-- Schema notes (these matter — earlier draft of this plan got them wrong):
--   - contacts has NO direct event_id column. Link is via contact_events.
--   - emails are in contact_emails (one contact -> many emails).
--   - posts holds post_url + posted_at via contact_events.post_id.
--   - companies joins from contacts.current_company_id.
--   - credits live in TWO tables: user_signups.free_credits + customers.credits_balance.
--   - paid status = customers.total_purchased_credits > 0.
-- ============================================


-- ─────────────────────────────────────────────
-- TABLE: api_keys
-- Hashed API keys. Raw key shown once on creation.
-- daily_credit_cap is per-key (NULL = unlimited).
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  daily_credit_cap INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT api_keys_hash_unique UNIQUE (key_hash),
  CONSTRAINT api_keys_daily_cap_non_negative CHECK (daily_credit_cap IS NULL OR daily_credit_cap >= 0)
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own api keys" ON api_keys;
CREATE POLICY "Users can read own api keys"
  ON api_keys FOR SELECT USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own api keys" ON api_keys;
CREATE POLICY "Users can insert own api keys"
  ON api_keys FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own api keys" ON api_keys;
CREATE POLICY "Users can update own api keys"
  ON api_keys FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (user_id);


-- ─────────────────────────────────────────────
-- TABLE: api_usage_log
-- Audit trail and idempotency cache for every API request.
-- idempotency_key + api_key_id is unique so retries return the cached body.
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  request_ip TEXT,
  request_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  response_time_ms INTEGER,
  idempotency_key TEXT,
  response_body JSONB,
  CONSTRAINT api_usage_idem_unique UNIQUE (api_key_id, idempotency_key)
);

ALTER TABLE api_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own usage logs" ON api_usage_log;
CREATE POLICY "Users can read own usage logs"
  ON api_usage_log FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_api_usage_key_time
  ON api_usage_log (api_key_id, request_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_daily_cap
  ON api_usage_log (api_key_id, request_timestamp)
  WHERE credits_used > 0;


-- ─────────────────────────────────────────────
-- RPC: is_api_eligible
-- Paid-tier check. Used at key-creation AND at every request.
-- Eligible iff customers.total_purchased_credits > 0.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_api_eligible(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_eligible BOOLEAN;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT (total_purchased_credits > 0) INTO v_eligible
  FROM customers WHERE user_id = p_user_id;
  RETURN COALESCE(v_eligible, false);
END;
$$;


-- ─────────────────────────────────────────────
-- RPC: api_daily_credit_spend
-- Sum of credits_used by a key since UTC midnight today.
-- Used to enforce daily_credit_cap.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api_daily_credit_spend(p_api_key_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_spent INTEGER;
BEGIN
  SELECT COALESCE(SUM(credits_used), 0) INTO v_spent
  FROM api_usage_log
  WHERE api_key_id = p_api_key_id
    AND request_timestamp >= date_trunc('day', now() AT TIME ZONE 'UTC')
    AND credits_used > 0;
  RETURN v_spent;
END;
$$;


-- ─────────────────────────────────────────────
-- RPC: api_get_user_credits
-- Total balance (free + paid) for the API user.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api_get_user_credits(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_free INTEGER;
  v_paid INTEGER;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  SELECT COALESCE(free_credits, 0) INTO v_free FROM user_signups WHERE user_id = p_user_id;
  SELECT COALESCE(credits_balance, 0) INTO v_paid FROM customers WHERE user_id = p_user_id;
  RETURN COALESCE(v_free, 0) + COALESCE(v_paid, 0);
END;
$$;


-- ─────────────────────────────────────────────
-- RPC: api_get_event_unlock_status
-- Same shape as get_event_unlock_status but takes p_user_id.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api_get_event_unlock_status(p_user_id UUID, p_event_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_total INTEGER;
  v_with_email INTEGER;
  v_unlocked INTEGER := 0;
  v_balance INTEGER := 0;
  v_is_subscribed BOOLEAN := false;
BEGIN
  SELECT COUNT(DISTINCT c.id) INTO v_total
  FROM contacts c
  JOIN contact_events ce ON ce.contact_id = c.id
  WHERE ce.event_id = p_event_id
    AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours';

  SELECT COUNT(DISTINCT ce.contact_id) INTO v_with_email
  FROM contact_events ce
  JOIN contacts c ON c.id = ce.contact_id
  JOIN contact_emails em ON em.contact_id = ce.contact_id AND em.is_primary = true
  WHERE ce.event_id = p_event_id
    AND em.email IS NOT NULL
    AND em.email != ''
    AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours';

  IF p_user_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_unlocked
    FROM customer_contact_access
    WHERE user_id = p_user_id AND event_id = p_event_id;

    v_balance := api_get_user_credits(p_user_id);

    SELECT EXISTS(
      SELECT 1 FROM customer_event_subscriptions
      WHERE user_id = p_user_id AND event_id = p_event_id
    ) INTO v_is_subscribed;
  END IF;

  RETURN json_build_object(
    'total_contacts', v_total,
    'unlocked_count', v_unlocked,
    'remaining_count', v_total - v_unlocked,
    'contacts_with_email', v_with_email,
    'user_balance', v_balance,
    'is_subscribed', v_is_subscribed
  );
END;
$$;


-- ─────────────────────────────────────────────
-- RPC: api_unlock_event_contacts
-- Mirrors unlock_event_contacts exactly, but accepts p_user_id and
-- enforces an optional p_max_to_unlock cap (used by daily_credit_cap).
-- Returns same JSON shape.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api_unlock_event_contacts(
  p_user_id UUID,
  p_event_id UUID,
  p_count INTEGER,
  p_max_to_unlock INTEGER DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_free INTEGER;
  v_paid INTEGER;
  v_total_balance INTEGER;
  v_available_count INTEGER;
  v_actual_count INTEGER;
  v_actual_inserted INTEGER;
  v_deduct_free INTEGER;
  v_deduct_paid INTEGER;
  v_new_balance INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'User ID required');
  END IF;
  IF p_count <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'Invalid count');
  END IF;

  SELECT free_credits INTO v_free FROM user_signups WHERE user_id = p_user_id;
  IF v_free IS NULL THEN
    INSERT INTO user_signups (user_id, free_credits) VALUES (p_user_id, 20)
    ON CONFLICT (user_id) DO NOTHING;
    v_free := 20;
  END IF;
  SELECT credits_balance INTO v_paid FROM customers WHERE user_id = p_user_id;
  v_paid := COALESCE(v_paid, 0);
  v_total_balance := v_free + v_paid;

  IF v_total_balance <= 0 THEN
    RETURN json_build_object(
      'success', false,
      'message', 'No credits remaining',
      'current_balance', 0
    );
  END IF;

  -- Settled rows only (3+ hours since last update) — must match unlock_event_contacts.
  SELECT COUNT(*) INTO v_available_count
  FROM contacts c
  JOIN contact_events ce ON ce.contact_id = c.id
  WHERE ce.event_id = p_event_id
    AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
    AND NOT EXISTS (
      SELECT 1 FROM customer_contact_access cca
      WHERE cca.user_id = p_user_id
        AND cca.contact_id = c.id
        AND cca.event_id = p_event_id
    );

  IF v_available_count = 0 THEN
    RETURN json_build_object('success', false, 'message', 'No more contacts to unlock');
  END IF;

  v_actual_count := LEAST(p_count, v_available_count, v_total_balance);
  IF p_max_to_unlock IS NOT NULL THEN
    v_actual_count := LEAST(v_actual_count, p_max_to_unlock);
  END IF;

  IF v_actual_count <= 0 THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Daily spend cap reached',
      'credits_spent', 0,
      'new_balance', v_total_balance
    );
  END IF;

  -- Auto-subscribe (idempotent).
  INSERT INTO customer_event_subscriptions (user_id, event_id)
  VALUES (p_user_id, p_event_id)
  ON CONFLICT (user_id, event_id) DO NOTHING;

  -- Insert best-available contacts (email-verified first, then most recent post).
  INSERT INTO customer_contact_access (user_id, contact_id, event_id)
  SELECT p_user_id, contact_id, p_event_id
  FROM (
    SELECT DISTINCT ON (c.id)
      c.id AS contact_id,
      (CASE WHEN em.email IS NOT NULL AND em.email != '' THEN 0 ELSE 1 END) AS email_priority,
      p.posted_at
    FROM contacts c
    JOIN contact_events ce ON ce.contact_id = c.id
    LEFT JOIN posts p ON p.id = ce.post_id
    LEFT JOIN contact_emails em ON em.contact_id = c.id AND em.is_primary = true
    WHERE ce.event_id = p_event_id
      AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
      AND NOT EXISTS (
        SELECT 1 FROM customer_contact_access cca
        WHERE cca.user_id = p_user_id
          AND cca.contact_id = c.id
          AND cca.event_id = p_event_id
      )
    ORDER BY c.id,
      (CASE WHEN em.email IS NOT NULL AND em.email != '' THEN 0 ELSE 1 END),
      p.posted_at DESC NULLS LAST
  ) deduplicated
  ORDER BY email_priority, posted_at DESC NULLS LAST
  LIMIT v_actual_count
  ON CONFLICT (user_id, contact_id, event_id) DO NOTHING;

  GET DIAGNOSTICS v_actual_inserted = ROW_COUNT;

  v_deduct_free := LEAST(v_actual_inserted, v_free);
  v_deduct_paid := v_actual_inserted - v_deduct_free;

  IF v_deduct_free > 0 THEN
    UPDATE user_signups
    SET free_credits = free_credits - v_deduct_free, updated_at = now()
    WHERE user_id = p_user_id;
  END IF;
  IF v_deduct_paid > 0 THEN
    UPDATE customers
    SET credits_balance = credits_balance - v_deduct_paid, updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  v_new_balance := api_get_user_credits(p_user_id);

  RETURN json_build_object(
    'success', true,
    'message', v_actual_inserted || ' contacts unlocked',
    'credits_spent', v_actual_inserted,
    'new_balance', v_new_balance,
    'contacts_unlocked', v_actual_inserted
  );
END;
$$;


-- ─────────────────────────────────────────────
-- RPC: api_get_unlocked_contacts
-- Paginated list of the user's unlocked contacts for an event.
-- Returns full enriched payload (matches get_subscribed_event_contacts shape).
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api_get_unlocked_contacts(
  p_user_id UUID,
  p_event_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_total INTEGER;
  v_contacts JSON;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM customer_contact_access cca
  WHERE cca.user_id = p_user_id AND cca.event_id = p_event_id;

  SELECT json_agg(row_to_json(t)) INTO v_contacts
  FROM (
    SELECT
      c.id AS contact_id,
      c.full_name,
      c.first_name,
      c.last_name,
      c.current_title,
      c.headline,
      c.linkedin_url AS contact_linkedin_url,
      c.city,
      c.country,
      cem.email,
      cem.status AS email_status,
      cem.provider AS email_provider,
      co.name AS company_name,
      co.linkedin_url AS company_linkedin_url,
      co.domain AS company_domain,
      co.website AS company_website,
      co.industry AS company_industry,
      co.size_range AS company_size,
      co.headquarters AS company_headquarters,
      co.founded_year AS company_founded_year,
      p.post_url,
      p.posted_at AS post_date,
      ce.source_type AS source,
      cca.charged_at,
      cca.is_downloaded
    FROM customer_contact_access cca
    JOIN contacts c ON c.id = cca.contact_id
    LEFT JOIN contact_events ce ON ce.contact_id = c.id AND ce.event_id = cca.event_id
    LEFT JOIN LATERAL (
      SELECT e.email, e.status, e.provider
      FROM contact_emails e
      WHERE e.contact_id = c.id AND e.status = 'valid'
      ORDER BY e.is_primary DESC NULLS LAST
      LIMIT 1
    ) cem ON true
    LEFT JOIN companies co ON c.current_company_id = co.id
    LEFT JOIN posts p ON ce.post_id = p.id
    WHERE cca.user_id = p_user_id AND cca.event_id = p_event_id
    ORDER BY cca.charged_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  RETURN json_build_object(
    'contacts', COALESCE(v_contacts, '[]'::json),
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'has_more', (p_offset + p_limit) < v_total
  );
END;
$$;
