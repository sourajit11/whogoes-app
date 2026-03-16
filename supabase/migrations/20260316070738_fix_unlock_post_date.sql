-- Fix: unlock_event_contacts was referencing c.post_date which doesn't exist.
-- The date lives on the posts table as posted_at, joined via contact_events.post_id.

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

  -- Get free credits (lazy-create if missing)
  SELECT free_credits INTO v_free FROM user_signups WHERE user_id = v_user_id;
  IF v_free IS NULL THEN
    INSERT INTO user_signups (user_id, free_credits)
    VALUES (v_user_id, 20)
    ON CONFLICT (user_id) DO NOTHING;
    v_free := 20;
  END IF;

  -- Get paid credits
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

  -- Count contacts not yet unlocked by this user
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

  -- Unlock the minimum of: requested, available, total balance
  v_actual_count := LEAST(p_count, v_available_count, v_total_balance);

  -- Create subscription if not exists
  INSERT INTO customer_event_subscriptions (user_id, event_id)
  VALUES (v_user_id, p_event_id)
  ON CONFLICT (user_id, event_id) DO NOTHING;

  -- Insert access records for the best available contacts
  -- Priority: contacts with email first, then by most recent posted_at
  INSERT INTO customer_contact_access (user_id, contact_id, event_id)
  SELECT v_user_id, c.id, p_event_id
  FROM contacts c
  JOIN contact_events ce ON ce.contact_id = c.id
  LEFT JOIN posts p ON p.id = ce.post_id
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
    p.posted_at DESC NULLS LAST
  LIMIT v_actual_count;

  -- Deduct credits: free first, then paid
  v_deduct_free := LEAST(v_actual_count, v_free);
  v_deduct_paid := v_actual_count - v_deduct_free;

  -- Update free credits
  IF v_deduct_free > 0 THEN
    UPDATE user_signups
    SET free_credits = free_credits - v_deduct_free, updated_at = now()
    WHERE user_id = v_user_id;
  END IF;

  -- Update paid credits (only if needed and row exists)
  IF v_deduct_paid > 0 THEN
    UPDATE customers
    SET credits_balance = credits_balance - v_deduct_paid, updated_at = now()
    WHERE user_id = v_user_id;
  END IF;

  -- Calculate new total balance
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
