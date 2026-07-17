-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- Two-path pricing (Souraa, 2026-07-12):
--   Path A "take the whole list": 1 credit per contact and verified emails are
--     INCLUDED, but only when the unlock is unfiltered and ends with the user
--     owning every contact of the event (a genuine bulk commitment).
--   Path B "filter to your ICP": unchanged - 1 credit per identity, +1 credit
--     per revealed email.
-- The full-list check runs AFTER the insert, so chunked client unlocks (1000 per
-- call sharing one batch via p_batch_id) qualify on their final chunk; the email
-- flag is then applied to every row of that batch. email_charged_at stays NULL
-- for included emails (they were not individually charged).

CREATE OR REPLACE FUNCTION public.unlock_event_contacts(p_event_id uuid, p_count integer, p_filters jsonb DEFAULT '{}'::jsonb, p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
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
  v_batch_id UUID;
  v_created_batch BOOLEAN := false;
  v_no_filters BOOLEAN;
  v_full_list BOOLEAN := false;
  v_emails_included INTEGER := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;
  IF p_count <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'Invalid count');
  END IF;

  SELECT free_credits INTO v_free FROM user_signups WHERE user_id = v_user_id;
  IF v_free IS NULL THEN
    INSERT INTO user_signups (user_id, free_credits) VALUES (v_user_id, 20)
    ON CONFLICT (user_id) DO NOTHING;
    v_free := 20;
  END IF;

  SELECT credits_balance INTO v_paid FROM customers WHERE user_id = v_user_id;
  v_paid := COALESCE(v_paid, 0);
  v_total_balance := v_free + v_paid;

  IF v_total_balance <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'No credits remaining', 'current_balance', 0);
  END IF;

  v_actual_count := LEAST(p_count, v_total_balance);

  INSERT INTO customer_event_subscriptions (user_id, event_id)
  VALUES (v_user_id, p_event_id)
  ON CONFLICT (user_id, event_id) DO NOTHING;

  -- Continue the caller's batch only if it really is theirs, for this event;
  -- otherwise start a fresh one.
  IF p_batch_id IS NOT NULL THEN
    SELECT id INTO v_batch_id FROM unlock_batches
    WHERE id = p_batch_id AND user_id = v_user_id AND event_id = p_event_id;
  END IF;
  IF v_batch_id IS NULL THEN
    INSERT INTO unlock_batches (user_id, event_id, filters, requested_count)
    VALUES (v_user_id, p_event_id, COALESCE(p_filters, '{}'::jsonb), p_count)
    RETURNING id INTO v_batch_id;
    v_created_batch := true;
  END IF;

  -- Candidate-first selection from the shared filter helper (email-verified first,
  -- then most recent). p_filters = {} returns the whole event (legacy behavior).
  INSERT INTO customer_contact_access (user_id, contact_id, event_id, batch_id)
  SELECT v_user_id, f.contact_id, p_event_id, v_batch_id
  FROM public.event_filtered_contact_ids(p_event_id, p_filters) f
  WHERE NOT EXISTS (
    SELECT 1 FROM customer_contact_access cca
    WHERE cca.user_id = v_user_id AND cca.contact_id = f.contact_id AND cca.event_id = p_event_id
  )
  ORDER BY (CASE WHEN f.has_email THEN 0 ELSE 1 END), f.created_at DESC NULLS LAST
  LIMIT v_actual_count
  ON CONFLICT (user_id, contact_id, event_id) DO NOTHING;

  GET DIAGNOSTICS v_actual_inserted = ROW_COUNT;
  IF v_actual_inserted = 0 THEN
    -- Don't leave an empty batch behind when nothing was delivered.
    IF v_created_batch THEN
      DELETE FROM unlock_batches WHERE id = v_batch_id;
    END IF;
    RETURN json_build_object('success', false, 'message', 'No more contacts to unlock');
  END IF;

  UPDATE unlock_batches
  SET unlocked_count = unlocked_count + v_actual_inserted
  WHERE id = v_batch_id;

  -- Full-list bonus: an unfiltered unlock that leaves nothing locked in the event
  -- includes every verified email of this purchase (batch) at no extra credit.
  v_no_filters := (p_filters IS NULL OR p_filters = '{}'::jsonb);
  IF v_no_filters THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.event_filtered_contact_ids(p_event_id, '{}'::jsonb) f
      WHERE NOT EXISTS (
        SELECT 1 FROM customer_contact_access cca
        WHERE cca.user_id = v_user_id AND cca.event_id = p_event_id AND cca.contact_id = f.contact_id
      )
    ) INTO v_full_list;

    IF v_full_list THEN
      UPDATE customer_contact_access cca
      SET email_unlocked = true
      WHERE cca.user_id = v_user_id AND cca.event_id = p_event_id
        AND cca.batch_id = v_batch_id AND cca.email_unlocked = false;
      GET DIAGNOSTICS v_emails_included = ROW_COUNT;
    END IF;
  END IF;

  v_deduct_free := LEAST(v_actual_inserted, v_free);
  v_deduct_paid := v_actual_inserted - v_deduct_free;

  IF v_deduct_free > 0 THEN
    UPDATE user_signups SET free_credits = free_credits - v_deduct_free, updated_at = now() WHERE user_id = v_user_id;
  END IF;
  IF v_deduct_paid > 0 THEN
    UPDATE customers SET credits_balance = credits_balance - v_deduct_paid, updated_at = now() WHERE user_id = v_user_id;
  END IF;

  SELECT COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0)
  INTO v_new_balance
  FROM user_signups us LEFT JOIN customers c ON c.user_id = us.user_id
  WHERE us.user_id = v_user_id;

  RETURN json_build_object(
    'success', true,
    'message', v_actual_inserted || ' contacts unlocked',
    'credits_spent', v_actual_inserted,
    'new_balance', v_new_balance,
    'contacts_unlocked', v_actual_inserted,
    'batch_id', v_batch_id,
    'full_list', v_full_list,
    'emails_included', v_emails_included
  );
END;
$function$;
