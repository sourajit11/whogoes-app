-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- Unlock history: persist which ICP filter produced each unlock so My Events can
-- show "Jul 2 · VP + SaaS -> 214 contacts" per batch and let the user re-apply a
-- batch's filters. Before this, the filter jsonb passed to unlock_event_contacts
-- was discarded and a customer had no way to reconstruct what they bought.
--
-- The client unlocks in chunks of 1,000 to stay under statement_timeout; all
-- chunks of one logical unlock share one batch row via p_batch_id (first call
-- creates the batch and returns its id, later calls pass it back).

CREATE TABLE public.unlock_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_count integer,
  unlocked_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_unlock_batches_user_event
  ON public.unlock_batches (user_id, event_id, created_at DESC);

ALTER TABLE public.unlock_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY unlock_batches_select_own ON public.unlock_batches
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Existing access rows stay batch-less ("earlier unlocks" in the UI).
ALTER TABLE public.customer_contact_access
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.unlock_batches(id) ON DELETE SET NULL;

CREATE INDEX idx_cca_batch
  ON public.customer_contact_access (batch_id)
  WHERE batch_id IS NOT NULL;

-- unlock_event_contacts gains p_batch_id. Drop the 3-arg version first so calls
-- that pass 3 args resolve unambiguously to the new 4-arg default.
DROP FUNCTION IF EXISTS public.unlock_event_contacts(uuid, integer, jsonb);

CREATE OR REPLACE FUNCTION public.unlock_event_contacts(
  p_event_id uuid,
  p_count integer,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_batch_id uuid DEFAULT NULL
)
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
    'batch_id', v_batch_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.unlock_event_contacts(uuid, integer, jsonb, uuid) TO authenticated, service_role;
