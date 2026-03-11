-- ============================================
-- WhoGoes - Unlock Credits System RPCs
-- Run this in Supabase SQL Editor AFTER 01-tables.sql
-- ============================================

-- RPC: unlock_event_contacts
-- Unlocks a specified number of contacts from an event.
-- Contacts are prioritized: email-verified first, then most recent post_date.
-- Creates a subscription automatically if one doesn't exist.
CREATE OR REPLACE FUNCTION unlock_event_contacts(p_event_id UUID, p_count INTEGER)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_balance INTEGER;
  v_available_count INTEGER;
  v_actual_count INTEGER;
  v_new_balance INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  -- Get current balance
  SELECT balance INTO v_balance FROM customer_credits WHERE user_id = v_user_id;
  IF v_balance IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'No credits account found');
  END IF;

  IF v_balance <= 0 THEN
    RETURN json_build_object(
      'success', false,
      'message', 'No credits remaining',
      'current_balance', 0
    );
  END IF;

  IF p_count <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'Invalid count');
  END IF;

  -- Count contacts not yet unlocked by this user
  SELECT COUNT(*) INTO v_available_count
  FROM contacts c
  WHERE c.event_id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM customer_contact_access cca
      WHERE cca.user_id = v_user_id
        AND cca.contact_id = c.id
        AND cca.event_id = p_event_id
    );

  IF v_available_count = 0 THEN
    RETURN json_build_object('success', false, 'message', 'No more contacts to unlock');
  END IF;

  -- Unlock the minimum of: requested, available, balance
  v_actual_count := LEAST(p_count, v_available_count, v_balance);

  -- Create subscription if not exists
  INSERT INTO customer_event_subscriptions (user_id, event_id)
  VALUES (v_user_id, p_event_id)
  ON CONFLICT (user_id, event_id) DO NOTHING;

  -- Insert access records for the best available contacts
  -- Priority: contacts with email first, then by most recent post_date
  INSERT INTO customer_contact_access (user_id, contact_id, event_id)
  SELECT v_user_id, c.id, p_event_id
  FROM contacts c
  WHERE c.event_id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM customer_contact_access cca
      WHERE cca.user_id = v_user_id
        AND cca.contact_id = c.id
        AND cca.event_id = p_event_id
    )
  ORDER BY
    (CASE WHEN c.email IS NOT NULL AND c.email != '' THEN 0 ELSE 1 END),
    c.post_date DESC NULLS LAST
  LIMIT v_actual_count;

  -- Deduct credits
  UPDATE customer_credits
  SET balance = balance - v_actual_count, updated_at = now()
  WHERE user_id = v_user_id;

  SELECT balance INTO v_new_balance FROM customer_credits WHERE user_id = v_user_id;

  RETURN json_build_object(
    'success', true,
    'message', v_actual_count || ' contacts unlocked',
    'credits_spent', v_actual_count,
    'new_balance', v_new_balance,
    'contacts_unlocked', v_actual_count
  );
END;
$$;


-- RPC: get_event_unlock_status
-- Returns unlock progress for a given event and the current user.
-- Works for both authenticated and unauthenticated users (returns zeros for anon).
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

  -- Total contacts for this event
  SELECT COUNT(*) INTO v_total
  FROM contacts WHERE event_id = p_event_id;

  -- Contacts with verified email
  SELECT COUNT(*) INTO v_with_email
  FROM contacts
  WHERE event_id = p_event_id
    AND email IS NOT NULL
    AND email != '';

  -- If authenticated, get user-specific data
  IF v_user_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_unlocked
    FROM customer_contact_access
    WHERE user_id = v_user_id AND event_id = p_event_id;

    SELECT COALESCE(balance, 0) INTO v_balance
    FROM customer_credits
    WHERE user_id = v_user_id;

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
