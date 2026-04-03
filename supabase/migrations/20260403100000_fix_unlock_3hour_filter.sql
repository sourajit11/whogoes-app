-- Fix: All unlock functions now apply the same 3-hour settled contact filter
-- as get_all_browsable_events.
--
-- Root cause: get_all_browsable_events counts contacts with:
--   COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
-- This hides contacts still being enriched by the n8n pipeline.
--
-- But unlock_event_contacts, get_event_unlock_status, and get_subscribed_events
-- counted ALL contacts regardless of age. This caused:
--   - Header showing 120 contacts (settled) vs slider showing 136 (all)
--   - Credits charged for contacts that the header doesn't count
--   - Phantom "remaining contacts" that can't actually be unlocked
--
-- Fix: Add the same 3-hour filter to all 3 functions.

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
  v_actual_inserted INTEGER;
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

  -- Count contacts not yet unlocked by this user.
  -- Only count contacts that have settled (3+ hours old) to match get_all_browsable_events.
  SELECT COUNT(*) INTO v_available_count
  FROM contacts c
  JOIN contact_events ce ON ce.contact_id = c.id
  WHERE ce.event_id = p_event_id
    AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
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

  -- Insert access records for the best available contacts.
  -- Priority: contacts with email first, then by most recent posted_at.
  -- Uses a deduplicating subquery to handle contacts with multiple is_primary emails,
  -- which would otherwise cause duplicate rows and inflate the LIMIT count.
  INSERT INTO customer_contact_access (user_id, contact_id, event_id)
  SELECT v_user_id, contact_id, p_event_id
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
        WHERE cca.user_id = v_user_id
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

  -- Use actual rows inserted (not v_actual_count) to prevent overcharging
  -- when the SELECT delivers fewer contacts than requested.
  GET DIAGNOSTICS v_actual_inserted = ROW_COUNT;

  -- Deduct credits: free first, then paid
  v_deduct_free := LEAST(v_actual_inserted, v_free);
  v_deduct_paid := v_actual_inserted - v_deduct_free;

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
    'message', v_actual_inserted || ' contacts unlocked',
    'credits_spent', v_actual_inserted,
    'new_balance', v_new_balance,
    'contacts_unlocked', v_actual_inserted
  );
END;
$$;


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

  -- Total contacts for this event.
  -- Only count settled contacts (3+ hours old) to match get_all_browsable_events.
  SELECT COUNT(DISTINCT c.id) INTO v_total
  FROM contacts c
  JOIN contact_events ce ON ce.contact_id = c.id
  WHERE ce.event_id = p_event_id
    AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours';

  -- Contacts with verified email (settled only)
  SELECT COUNT(DISTINCT ce.contact_id) INTO v_with_email
  FROM contact_events ce
  JOIN contacts c ON c.id = ce.contact_id
  JOIN contact_emails em ON em.contact_id = ce.contact_id AND em.is_primary = true
  WHERE ce.event_id = p_event_id
    AND em.email IS NOT NULL
    AND em.email != ''
    AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours';

  -- If authenticated, get user-specific data
  IF v_user_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_unlocked
    FROM customer_contact_access
    WHERE user_id = v_user_id AND event_id = p_event_id;

    -- Total balance = free + paid
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


CREATE OR REPLACE FUNCTION get_subscribed_events()
RETURNS TABLE (
  event_id UUID,
  event_name TEXT,
  event_year INTEGER,
  event_region TEXT,
  event_location TEXT,
  event_start_date DATE,
  is_active BOOLEAN,
  subscribed_at TIMESTAMPTZ,
  is_paused BOOLEAN,
  total_contacts BIGINT,
  new_contacts BIGINT,
  processed_contacts BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id AS event_id,
    e.name AS event_name,
    e.year AS event_year,
    e.region AS event_region,
    e.location AS event_location,
    e.start_date AS event_start_date,
    e.is_active,
    ces.subscribed_at,
    ces.is_paused,
    (SELECT COUNT(DISTINCT c2.id)
     FROM contacts c2
     JOIN contact_events ce ON ce.contact_id = c2.id
     WHERE ce.event_id = e.id
       AND COALESCE(c2.updated_at, c2.created_at) <= NOW() - INTERVAL '3 hours'
    ) AS total_contacts,
    (SELECT COUNT(*)
     FROM customer_contact_access cca
     WHERE cca.user_id = auth.uid()
       AND cca.event_id = e.id
       AND cca.is_downloaded = false
    ) AS new_contacts,
    (SELECT COUNT(*)
     FROM customer_contact_access cca
     WHERE cca.user_id = auth.uid()
       AND cca.event_id = e.id
       AND cca.is_downloaded = true
    ) AS processed_contacts
  FROM customer_event_subscriptions ces
  JOIN events e ON e.id = ces.event_id
  WHERE ces.user_id = auth.uid()
  ORDER BY ces.subscribed_at DESC;
END;
$$;
