-- Fix: admin_add_credits should add to user_signups.free_credits (not customers.credits_balance)
-- Also moves any previously admin-granted credits from paid → free

-- Step 1: Move existing mis-placed credits
-- Any user who has credits_balance > 0 but total_paid_amount = 0 got them from admin grants
UPDATE user_signups us
SET free_credits = us.free_credits + c.credits_balance,
    updated_at = now()
FROM customers c
WHERE c.user_id = us.user_id
  AND c.credits_balance > 0
  AND c.total_paid_amount = 0;

-- Zero out the mis-placed paid balance for those users
UPDATE customers
SET credits_balance = 0,
    updated_at = now()
WHERE credits_balance > 0
  AND total_paid_amount = 0;

-- Step 2: Replace the RPC to add to free credits instead of paid
CREATE OR REPLACE FUNCTION admin_add_credits(
  p_user_id UUID,
  p_credits_to_add INTEGER
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_new_free INTEGER;
BEGIN
  IF p_credits_to_add <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'Credits to add must be positive');
  END IF;

  INSERT INTO user_signups (user_id, free_credits)
  VALUES (p_user_id, p_credits_to_add)
  ON CONFLICT (user_id) DO UPDATE SET
    free_credits = user_signups.free_credits + p_credits_to_add,
    updated_at = now()
  RETURNING free_credits INTO v_new_free;

  RETURN json_build_object(
    'success', true,
    'message', format('%s free credits added', p_credits_to_add),
    'credits_added', p_credits_to_add,
    'new_balance', v_new_free
  );
END;
$$;
