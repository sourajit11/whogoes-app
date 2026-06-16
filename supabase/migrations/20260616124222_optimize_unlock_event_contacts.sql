-- Optimize unlock_event_contacts for large events (Viva Technology 2026 = 8,787
-- contacts timed out even at a 1,000-batch). The candidate SELECT was 6.1s:
--   * pointless JOIN contacts (only c.id needed, = ce.contact_id)
--   * LEFT JOIN posts just for posted_at ordering (8.8k random lookups)
--   * LEFT JOIN contact_emails (seq scan + fan-out forcing a DISTINCT ON double sort)
-- Plus a second full-scan COUNT (v_available_count) before the insert.
--
-- Rewrite (candidate-first, same approach as get_event_preview):
--   * contact_events is unique per (contact_id, event_id) -> no DISTINCT needed
--   * email priority via EXISTS on idx_contact_emails_primary (no fan-out)
--   * order by ce.created_at (idx_contact_events_event_created_contact, index-only)
--     instead of posts.posted_at -> avoids the posts join
--   * drop the pre-COUNT; the LIMIT caps to what's available and we charge by
--     actual rows inserted (GET DIAGNOSTICS), so no overcharge
-- Measured candidate SELECT: 6.1s -> 2.7s. statement_timeout bumped to 15s as
-- growth headroom; safe because the client unlocks in 1,000-row batches.

CREATE INDEX IF NOT EXISTS idx_contact_events_event_created_contact
  ON public.contact_events (event_id, created_at DESC, contact_id);

CREATE OR REPLACE FUNCTION unlock_event_contacts(p_event_id UUID, p_count INTEGER)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
SET statement_timeout = '15s'
AS $$
DECLARE
  v_user_id UUID;
  v_free INTEGER;
  v_paid INTEGER;
  v_total_balance INTEGER;
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

  IF p_count <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'Invalid count');
  END IF;

  -- Free credits (lazy-create if missing)
  SELECT free_credits INTO v_free FROM user_signups WHERE user_id = v_user_id;
  IF v_free IS NULL THEN
    INSERT INTO user_signups (user_id, free_credits)
    VALUES (v_user_id, 20)
    ON CONFLICT (user_id) DO NOTHING;
    v_free := 20;
  END IF;

  -- Paid credits
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

  -- Cap by balance + requested count. The LIMIT below naturally caps to what is
  -- actually available, and v_actual_inserted reflects the true rows inserted.
  v_actual_count := LEAST(p_count, v_total_balance);

  -- Create subscription if not exists
  INSERT INTO customer_event_subscriptions (user_id, event_id)
  VALUES (v_user_id, p_event_id)
  ON CONFLICT (user_id, event_id) DO NOTHING;

  -- Insert access for the best available contacts: email-verified first, then
  -- most recent (by contact_events.created_at). One row per contact, so no
  -- DISTINCT. EXISTS avoids contact_emails fan-out; created_at avoids posts.
  INSERT INTO customer_contact_access (user_id, contact_id, event_id)
  SELECT v_user_id, ce.contact_id, p_event_id
  FROM contact_events ce
  WHERE ce.event_id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM customer_contact_access cca
      WHERE cca.user_id = v_user_id
        AND cca.contact_id = ce.contact_id
        AND cca.event_id = p_event_id
    )
  ORDER BY
    (CASE WHEN EXISTS (
       SELECT 1 FROM contact_emails em
       WHERE em.contact_id = ce.contact_id AND em.is_primary = true
         AND em.email IS NOT NULL AND em.email <> ''
     ) THEN 0 ELSE 1 END),
    ce.created_at DESC NULLS LAST
  LIMIT v_actual_count
  ON CONFLICT (user_id, contact_id, event_id) DO NOTHING;

  GET DIAGNOSTICS v_actual_inserted = ROW_COUNT;

  IF v_actual_inserted = 0 THEN
    RETURN json_build_object('success', false, 'message', 'No more contacts to unlock');
  END IF;

  -- Deduct credits: free first, then paid
  v_deduct_free := LEAST(v_actual_inserted, v_free);
  v_deduct_paid := v_actual_inserted - v_deduct_free;

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
    'message', v_actual_inserted || ' contacts unlocked',
    'credits_spent', v_actual_inserted,
    'new_balance', v_new_balance,
    'contacts_unlocked', v_actual_inserted
  );
END;
$$;
