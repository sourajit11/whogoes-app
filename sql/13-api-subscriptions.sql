-- ============================================
-- WhoGoes Public API V2 — subscribe-and-poll feed
-- Run AFTER 10-api-keys.sql.
--
-- The transactional API (V1) makes the user's script drive every action.
-- V2 inverts: the user configures subscriptions in the dashboard (or via
-- /api/v1/subscriptions), then a single POST /api/v1/contacts/pull returns
-- only the contacts that are NEW since the last pull, capped per-event.
-- ============================================


-- ─────────────────────────────────────────────
-- Extend customer_event_subscriptions for the feed.
-- ─────────────────────────────────────────────

ALTER TABLE customer_event_subscriptions
  ADD COLUMN IF NOT EXISTS auto_unlock_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_unlocks_per_event INTEGER,
  ADD COLUMN IF NOT EXISTS last_api_pulled_at TIMESTAMPTZ;

ALTER TABLE customer_event_subscriptions
  DROP CONSTRAINT IF EXISTS ces_max_unlocks_non_negative;
ALTER TABLE customer_event_subscriptions
  ADD CONSTRAINT ces_max_unlocks_non_negative
  CHECK (max_unlocks_per_event IS NULL OR max_unlocks_per_event >= 0);

-- INSERT/UPDATE policies are needed so the dashboard (cookie-auth) can
-- create/edit subscriptions. The existing SELECT policy already allows
-- read access. Service-role bypasses RLS for API routes.
DROP POLICY IF EXISTS "Users can insert own subscriptions" ON customer_event_subscriptions;
CREATE POLICY "Users can insert own subscriptions"
  ON customer_event_subscriptions FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own subscriptions" ON customer_event_subscriptions;
CREATE POLICY "Users can update own subscriptions"
  ON customer_event_subscriptions FOR UPDATE
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own subscriptions" ON customer_event_subscriptions;
CREATE POLICY "Users can delete own subscriptions"
  ON customer_event_subscriptions FOR DELETE
  USING ((select auth.uid()) = user_id);


-- ─────────────────────────────────────────────
-- RPC: api_list_subscriptions
-- Returns the user's subscriptions enriched with event name, slug, and
-- per-event unlock counts. Used by the API (GET /subscriptions) and the
-- dashboard auto-unlock toggle.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api_list_subscriptions(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_rows JSON;
BEGIN
  SELECT json_agg(row_to_json(t)) INTO v_rows
  FROM (
    SELECT
      e.id AS event_id,
      e.name AS event_name,
      e.slug AS event_slug,
      ces.subscribed_at,
      ces.is_paused,
      ces.auto_unlock_enabled,
      ces.max_unlocks_per_event,
      ces.last_api_pulled_at,
      (SELECT COUNT(*) FROM customer_contact_access cca
        WHERE cca.user_id = p_user_id AND cca.event_id = e.id
      )::int AS unlocked_count
    FROM customer_event_subscriptions ces
    JOIN events e ON e.id = ces.event_id
    WHERE ces.user_id = p_user_id
    ORDER BY ces.subscribed_at DESC
  ) t;
  RETURN COALESCE(v_rows, '[]'::json);
END;
$$;


-- ─────────────────────────────────────────────
-- RPC: api_upsert_subscription
-- Create or update a subscription for the API user. Single round-trip.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api_upsert_subscription(
  p_user_id UUID,
  p_event_id UUID,
  p_auto_unlock_enabled BOOLEAN DEFAULT NULL,
  p_max_unlocks_per_event INTEGER DEFAULT NULL,
  p_is_paused BOOLEAN DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_row customer_event_subscriptions%ROWTYPE;
BEGIN
  IF p_max_unlocks_per_event IS NOT NULL AND p_max_unlocks_per_event < 0 THEN
    RETURN json_build_object('success', false, 'message', 'max_unlocks_per_event must be >= 0');
  END IF;

  INSERT INTO customer_event_subscriptions (
    user_id, event_id, auto_unlock_enabled, max_unlocks_per_event, is_paused
  )
  VALUES (
    p_user_id, p_event_id,
    COALESCE(p_auto_unlock_enabled, false),
    p_max_unlocks_per_event,
    COALESCE(p_is_paused, false)
  )
  ON CONFLICT (user_id, event_id) DO UPDATE SET
    auto_unlock_enabled = COALESCE(p_auto_unlock_enabled, customer_event_subscriptions.auto_unlock_enabled),
    max_unlocks_per_event = COALESCE(p_max_unlocks_per_event, customer_event_subscriptions.max_unlocks_per_event),
    is_paused = COALESCE(p_is_paused, customer_event_subscriptions.is_paused)
  RETURNING * INTO v_row;

  RETURN json_build_object(
    'success', true,
    'subscription', json_build_object(
      'event_id', v_row.event_id,
      'auto_unlock_enabled', v_row.auto_unlock_enabled,
      'max_unlocks_per_event', v_row.max_unlocks_per_event,
      'is_paused', v_row.is_paused,
      'last_api_pulled_at', v_row.last_api_pulled_at,
      'subscribed_at', v_row.subscribed_at
    )
  );
END;
$$;


-- ─────────────────────────────────────────────
-- RPC: api_pull_new_contacts
-- The heart of the feed API. For every active auto-unlock subscription,
-- unlock at most (max_unlocks_per_event - already_unlocked) contacts.
-- Honors total balance, optional global limit, and an optional p_max_total
-- cap (used by the daily spend cap).
--
-- p_dry_run = true returns the would-be unlock plan without inserting,
-- charging, or updating last_api_pulled_at.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api_pull_new_contacts(
  p_user_id UUID,
  p_global_limit INTEGER DEFAULT NULL,
  p_max_total INTEGER DEFAULT NULL,
  p_dry_run BOOLEAN DEFAULT false
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_free INTEGER;
  v_paid INTEGER;
  v_balance INTEGER;
  v_remaining INTEGER;       -- how many we can still unlock this call
  v_total_unlocked INTEGER := 0;
  v_breakdown JSONB := '[]'::jsonb;
  v_contact_ids UUID[] := ARRAY[]::UUID[];
  v_per_event_unlocked INTEGER;
  v_per_event_cap INTEGER;
  v_per_event_to_unlock INTEGER;
  v_inserted INTEGER;
  v_deduct_free INTEGER;
  v_deduct_paid INTEGER;
  v_new_balance INTEGER;
  sub RECORD;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'User ID required');
  END IF;

  -- Compute starting balance.
  SELECT COALESCE(free_credits, 0) INTO v_free FROM user_signups WHERE user_id = p_user_id;
  v_free := COALESCE(v_free, 0);
  SELECT COALESCE(credits_balance, 0) INTO v_paid FROM customers WHERE user_id = p_user_id;
  v_paid := COALESCE(v_paid, 0);
  v_balance := v_free + v_paid;

  IF v_balance <= 0 THEN
    RETURN json_build_object(
      'success', true,
      'dry_run', p_dry_run,
      'credits_spent', 0,
      'contacts_unlocked', 0,
      'new_balance', 0,
      'breakdown', '[]'::json,
      'message', 'No credits remaining'
    );
  END IF;

  -- The cap chain: balance is the hard limit; p_global_limit and p_max_total
  -- shrink it further if either is set. NULL means "no limit beyond balance".
  v_remaining := v_balance;
  IF p_global_limit IS NOT NULL THEN
    v_remaining := LEAST(v_remaining, p_global_limit);
  END IF;
  IF p_max_total IS NOT NULL THEN
    v_remaining := LEAST(v_remaining, p_max_total);
  END IF;

  IF v_remaining <= 0 THEN
    RETURN json_build_object(
      'success', true,
      'dry_run', p_dry_run,
      'credits_spent', 0,
      'contacts_unlocked', 0,
      'new_balance', v_balance,
      'breakdown', '[]'::json,
      'message', 'Daily spend cap reached'
    );
  END IF;

  -- Walk subscriptions oldest-first so the priority order is deterministic.
  FOR sub IN
    SELECT ces.event_id, e.name AS event_name, e.slug AS event_slug,
           ces.max_unlocks_per_event
    FROM customer_event_subscriptions ces
    JOIN events e ON e.id = ces.event_id
    WHERE ces.user_id = p_user_id
      AND ces.auto_unlock_enabled = true
      AND ces.is_paused = false
    ORDER BY ces.subscribed_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;

    -- Per-event cap: max(0, cap - already_unlocked). NULL cap = no cap.
    v_per_event_cap := sub.max_unlocks_per_event;
    SELECT COUNT(*) INTO v_per_event_unlocked
    FROM customer_contact_access
    WHERE user_id = p_user_id AND event_id = sub.event_id;

    IF v_per_event_cap IS NOT NULL THEN
      v_per_event_to_unlock := GREATEST(0, v_per_event_cap - v_per_event_unlocked);
    ELSE
      v_per_event_to_unlock := v_remaining;
    END IF;

    v_per_event_to_unlock := LEAST(v_per_event_to_unlock, v_remaining);
    IF v_per_event_to_unlock <= 0 THEN
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      -- Count how many are actually available right now, but don't insert.
      SELECT COUNT(*) INTO v_inserted
      FROM (
        SELECT 1
        FROM contacts c
        JOIN contact_events ce ON ce.contact_id = c.id
        WHERE ce.event_id = sub.event_id
          AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
          AND NOT EXISTS (
            SELECT 1 FROM customer_contact_access cca
            WHERE cca.user_id = p_user_id
              AND cca.contact_id = c.id
              AND cca.event_id = sub.event_id
          )
        GROUP BY c.id
        LIMIT v_per_event_to_unlock
      ) preview;
    ELSE
      -- Real insert. Mirrors api_unlock_event_contacts ordering exactly.
      WITH inserted AS (
        INSERT INTO customer_contact_access (user_id, contact_id, event_id)
        SELECT p_user_id, contact_id, sub.event_id
        FROM (
          SELECT DISTINCT ON (c.id)
            c.id AS contact_id,
            (CASE WHEN em.email IS NOT NULL AND em.email != '' THEN 0 ELSE 1 END) AS email_priority,
            p.posted_at
          FROM contacts c
          JOIN contact_events ce ON ce.contact_id = c.id
          LEFT JOIN posts p ON p.id = ce.post_id
          LEFT JOIN contact_emails em ON em.contact_id = c.id AND em.is_primary = true
          WHERE ce.event_id = sub.event_id
            AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
            AND NOT EXISTS (
              SELECT 1 FROM customer_contact_access cca
              WHERE cca.user_id = p_user_id
                AND cca.contact_id = c.id
                AND cca.event_id = sub.event_id
            )
          ORDER BY c.id,
            (CASE WHEN em.email IS NOT NULL AND em.email != '' THEN 0 ELSE 1 END),
            p.posted_at DESC NULLS LAST
        ) deduplicated
        ORDER BY email_priority, posted_at DESC NULLS LAST
        LIMIT v_per_event_to_unlock
        ON CONFLICT (user_id, contact_id, event_id) DO NOTHING
        RETURNING contact_id
      )
      SELECT COUNT(*), COALESCE(array_agg(contact_id), ARRAY[]::UUID[])
      INTO v_inserted, v_contact_ids
      FROM inserted;
    END IF;

    IF v_inserted > 0 THEN
      v_total_unlocked := v_total_unlocked + v_inserted;
      v_remaining := v_remaining - v_inserted;
      v_breakdown := v_breakdown || jsonb_build_object(
        'event_id', sub.event_id,
        'event_slug', sub.event_slug,
        'event_name', sub.event_name,
        'unlocked', v_inserted
      );

      IF NOT p_dry_run THEN
        UPDATE customer_event_subscriptions
        SET last_api_pulled_at = now()
        WHERE user_id = p_user_id AND event_id = sub.event_id;
      END IF;
    END IF;
  END LOOP;

  -- Deduct credits unless dry-run.
  IF NOT p_dry_run AND v_total_unlocked > 0 THEN
    v_deduct_free := LEAST(v_total_unlocked, v_free);
    v_deduct_paid := v_total_unlocked - v_deduct_free;

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
  END IF;

  -- Compute new balance for the response.
  IF p_dry_run THEN
    v_new_balance := v_balance;
  ELSE
    SELECT COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0)
    INTO v_new_balance
    FROM user_signups us
    LEFT JOIN customers c ON c.user_id = us.user_id
    WHERE us.user_id = p_user_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'dry_run', p_dry_run,
    'credits_spent', CASE WHEN p_dry_run THEN 0 ELSE v_total_unlocked END,
    'contacts_unlocked', v_total_unlocked,
    'new_balance', COALESCE(v_new_balance, v_balance),
    'breakdown', v_breakdown
  );
END;
$$;
