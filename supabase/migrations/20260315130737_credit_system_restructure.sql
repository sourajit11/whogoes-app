-- ============================================
-- Migration: Restructure credit system
-- Replace customer_credits + old customers with user_signups + new customers
-- Remove auth.users trigger that caused signup errors
-- ============================================

-- Step 1: Remove old trigger and function (do this first to fix signup errors)
DROP TRIGGER IF EXISTS on_auth_user_created_credits ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user_credits();

-- Step 2: Drop old admin view that depends on old customers table
DROP VIEW IF EXISTS admin_customer_overview;

-- Step 3: Drop old customers table and its dependent customer_event_access table
-- The old customers table has a different schema (company_name, full_name, email)
-- and is not compatible with the new credit system
DROP TABLE IF EXISTS customer_event_access;
DROP TABLE IF EXISTS customers;

-- Step 4: Create new tables

CREATE TABLE user_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  free_credits INTEGER NOT NULL DEFAULT 20,
  signed_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_signups_user_unique UNIQUE (user_id),
  CONSTRAINT user_signups_credits_non_negative CHECK (free_credits >= 0)
);

ALTER TABLE user_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own signup" ON user_signups FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_balance INTEGER NOT NULL DEFAULT 0,
  total_purchased_credits INTEGER NOT NULL DEFAULT 0,
  total_paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  last_payment_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customers_user_unique UNIQUE (user_id),
  CONSTRAINT customers_balance_non_negative CHECK (credits_balance >= 0)
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own customer record" ON customers FOR SELECT USING (auth.uid() = user_id);

-- Step 5: Migrate existing data from customer_credits (if it exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_credits' AND table_schema = 'public') THEN
    INSERT INTO user_signups (user_id, free_credits, signed_up_at)
    SELECT user_id, balance, created_at FROM customer_credits
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END $$;


-- Step 4: Update RPCs

-- get_customer_credits: returns total (free + paid), lazy-creates user_signups row
CREATE OR REPLACE FUNCTION get_customer_credits()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_free INTEGER;
  v_paid INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT free_credits INTO v_free FROM user_signups WHERE user_id = v_user_id;
  IF v_free IS NULL THEN
    INSERT INTO user_signups (user_id, free_credits)
    VALUES (v_user_id, 20)
    ON CONFLICT (user_id) DO NOTHING;
    v_free := 20;
  END IF;

  SELECT credits_balance INTO v_paid FROM customers WHERE user_id = v_user_id;
  v_paid := COALESCE(v_paid, 0);

  RETURN v_free + v_paid;
END;
$$;


-- unlock_event_contacts: deducts free credits first, then paid
CREATE OR REPLACE FUNCTION unlock_event_contacts(p_event_id UUID, p_count INTEGER)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_free INTEGER;
  v_paid INTEGER;
  v_total_balance INTEGER;
  v_available_count INTEGER;
  v_actual_count INTEGER;
  v_deduct_free INTEGER;
  v_deduct_paid INTEGER;
  v_new_balance INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT free_credits INTO v_free FROM user_signups WHERE user_id = v_user_id;
  IF v_free IS NULL THEN
    INSERT INTO user_signups (user_id, free_credits)
    VALUES (v_user_id, 20)
    ON CONFLICT (user_id) DO NOTHING;
    v_free := 20;
  END IF;

  SELECT credits_balance INTO v_paid FROM customers WHERE user_id = v_user_id;
  v_paid := COALESCE(v_paid, 0);

  v_total_balance := v_free + v_paid;

  IF v_total_balance <= 0 THEN
    RETURN json_build_object(
      'success', false,
      'message', 'No credits remaining',
      'current_balance', 0
    );
  END IF;

  IF p_count <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'Invalid count');
  END IF;

  SELECT COUNT(*) INTO v_available_count
  FROM contacts c
  JOIN contact_events ce ON ce.contact_id = c.id
  WHERE ce.event_id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM customer_contact_access cca
      WHERE cca.user_id = v_user_id
        AND cca.contact_id = c.id
        AND cca.event_id = p_event_id
    );

  IF v_available_count = 0 THEN
    RETURN json_build_object('success', false, 'message', 'No more contacts to unlock');
  END IF;

  v_actual_count := LEAST(p_count, v_available_count, v_total_balance);

  INSERT INTO customer_event_subscriptions (user_id, event_id)
  VALUES (v_user_id, p_event_id)
  ON CONFLICT (user_id, event_id) DO NOTHING;

  INSERT INTO customer_contact_access (user_id, contact_id, event_id)
  SELECT v_user_id, c.id, p_event_id
  FROM contacts c
  JOIN contact_events ce ON ce.contact_id = c.id
  LEFT JOIN contact_emails em ON em.contact_id = c.id AND em.is_primary = true
  WHERE ce.event_id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM customer_contact_access cca
      WHERE cca.user_id = v_user_id
        AND cca.contact_id = c.id
        AND cca.event_id = p_event_id
    )
  ORDER BY
    (CASE WHEN em.email IS NOT NULL AND em.email != '' THEN 0 ELSE 1 END),
    c.post_date DESC NULLS LAST
  LIMIT v_actual_count;

  v_deduct_free := LEAST(v_actual_count, v_free);
  v_deduct_paid := v_actual_count - v_deduct_free;

  IF v_deduct_free > 0 THEN
    UPDATE user_signups
    SET free_credits = free_credits - v_deduct_free, updated_at = now()
    WHERE user_id = v_user_id;
  END IF;

  IF v_deduct_paid > 0 THEN
    UPDATE customers
    SET credits_balance = credits_balance - v_deduct_paid, updated_at = now()
    WHERE user_id = v_user_id;
  END IF;

  SELECT COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0)
  INTO v_new_balance
  FROM user_signups us
  LEFT JOIN customers c ON c.user_id = us.user_id
  WHERE us.user_id = v_user_id;

  RETURN json_build_object(
    'success', true,
    'message', v_actual_count || ' contacts unlocked',
    'credits_spent', v_actual_count,
    'new_balance', v_new_balance,
    'contacts_unlocked', v_actual_count
  );
END;
$$;


-- get_event_unlock_status: returns combined balance
CREATE OR REPLACE FUNCTION get_event_unlock_status(p_event_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_total INTEGER;
  v_with_email INTEGER;
  v_unlocked INTEGER := 0;
  v_balance INTEGER := 0;
  v_is_subscribed BOOLEAN := false;
BEGIN
  v_user_id := auth.uid();

  SELECT COUNT(DISTINCT ce.contact_id) INTO v_total
  FROM contact_events ce
  WHERE ce.event_id = p_event_id;

  SELECT COUNT(DISTINCT ce.contact_id) INTO v_with_email
  FROM contact_events ce
  JOIN contact_emails em ON em.contact_id = ce.contact_id AND em.is_primary = true
  WHERE ce.event_id = p_event_id
    AND em.email IS NOT NULL
    AND em.email != '';

  IF v_user_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_unlocked
    FROM customer_contact_access
    WHERE user_id = v_user_id AND event_id = p_event_id;

    SELECT COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0)
    INTO v_balance
    FROM user_signups us
    LEFT JOIN customers c ON c.user_id = us.user_id
    WHERE us.user_id = v_user_id;

    v_balance := COALESCE(v_balance, 0);

    SELECT EXISTS(
      SELECT 1 FROM customer_event_subscriptions
      WHERE user_id = v_user_id AND event_id = p_event_id
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


-- Step 5: Update admin views and RPCs

CREATE OR REPLACE VIEW admin_customer_overview AS
SELECT
  u.id AS user_id,
  u.email,
  u.created_at AS signed_up_at,
  COALESCE(us.free_credits, 0) AS free_credits,
  COALESCE(c.credits_balance, 0) AS paid_credits,
  COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0) AS credit_balance,
  COALESCE(usage.total_unlocked, 0) AS contacts_unlocked,
  COALESCE(c.total_paid_amount, 0) AS total_paid_amount,
  COALESCE(subs.event_count, 0) AS subscribed_events,
  usage.last_activity
FROM auth.users u
LEFT JOIN user_signups us ON us.user_id = u.id
LEFT JOIN customers c ON c.user_id = u.id
LEFT JOIN (
  SELECT
    user_id,
    COUNT(*) AS total_unlocked,
    MAX(charged_at) AS last_activity
  FROM customer_contact_access
  GROUP BY user_id
) usage ON usage.user_id = u.id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS event_count
  FROM customer_event_subscriptions
  GROUP BY user_id
) subs ON subs.user_id = u.id
ORDER BY u.created_at DESC;


CREATE OR REPLACE FUNCTION admin_get_business_stats()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_total_users INTEGER;
  v_users_this_month INTEGER;
  v_total_credits_consumed INTEGER;
  v_credits_this_month INTEGER;
  v_total_events INTEGER;
  v_active_events INTEGER;
  v_total_contacts INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_users FROM auth.users;

  SELECT COUNT(*) INTO v_users_this_month
  FROM auth.users
  WHERE created_at >= date_trunc('month', now());

  SELECT COUNT(*) INTO v_total_credits_consumed
  FROM customer_contact_access;

  SELECT COUNT(*) INTO v_credits_this_month
  FROM customer_contact_access
  WHERE charged_at >= date_trunc('month', now());

  SELECT COUNT(*) INTO v_total_events FROM events;

  SELECT COUNT(*) INTO v_active_events
  FROM events WHERE is_active = true;

  SELECT COUNT(*) INTO v_total_contacts FROM contacts;

  RETURN json_build_object(
    'total_users', v_total_users,
    'users_this_month', v_users_this_month,
    'total_credits_consumed', v_total_credits_consumed,
    'credits_this_month', v_credits_this_month,
    'total_events', v_total_events,
    'active_events', v_active_events,
    'total_contacts', v_total_contacts
  );
END;
$$;


CREATE OR REPLACE FUNCTION admin_adjust_credits(
  p_user_id UUID,
  p_new_balance INTEGER
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF p_new_balance < 0 THEN
    RETURN json_build_object('success', false, 'message', 'Balance cannot be negative');
  END IF;

  UPDATE customers
  SET credits_balance = p_new_balance, updated_at = now()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO customers (user_id, credits_balance, total_purchased_credits, total_paid_amount)
    VALUES (p_user_id, p_new_balance, p_new_balance, 0);
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', 'Paid credits updated',
    'new_balance', p_new_balance
  );
END;
$$;
