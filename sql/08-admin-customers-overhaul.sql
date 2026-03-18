-- ============================================
-- WhoGoes Admin Dashboard - Customers Overhaul
-- Run in Supabase SQL Editor AFTER 07-admin-dashboard-rpc.sql
--
-- Changes:
--   1. Updated admin_customer_overview view with 3 new columns:
--      - total_purchased_credits, last_payment_at, last_package
--   2. New RPC: admin_add_credits (atomically adds credits to a user)
-- ============================================

-- 1. Updated view: adds purchased credits, last payment date, and last package
-- DROP first because column order changed (PG can't reorder with CREATE OR REPLACE)
DROP VIEW IF EXISTS admin_customer_overview;
CREATE VIEW admin_customer_overview AS
SELECT
  u.id AS user_id,
  u.email,
  u.created_at AS signed_up_at,
  COALESCE(us.free_credits, 0) AS free_credits,
  COALESCE(c.credits_balance, 0) AS paid_credits,
  COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0) AS credit_balance,
  COALESCE(usage.total_unlocked, 0) AS contacts_unlocked,
  COALESCE(c.total_paid_amount, 0) AS total_paid_amount,
  COALESCE(c.total_purchased_credits, 0) AS total_purchased_credits,
  c.last_payment_at,
  COALESCE(subs.event_count, 0) AS subscribed_events,
  usage.last_activity,
  last_pkg.package_name AS last_package
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
LEFT JOIN LATERAL (
  SELECT package_name
  FROM payments
  WHERE payments.user_id = u.id AND payments.status = 'paid'
  ORDER BY payments.paid_at DESC
  LIMIT 1
) last_pkg ON true
ORDER BY u.created_at DESC;


-- 2. New RPC: Atomically add credits to a user
-- Unlike admin_adjust_credits which SETS the balance,
-- this ADDS to the existing balance (or creates the row if needed).
-- Admin-granted credits do NOT count as purchases (total_purchased_credits unchanged).
CREATE OR REPLACE FUNCTION admin_add_credits(
  p_user_id UUID,
  p_credits_to_add INTEGER
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  IF p_credits_to_add <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'Credits to add must be positive');
  END IF;

  INSERT INTO customers (user_id, credits_balance, total_purchased_credits, total_paid_amount)
  VALUES (p_user_id, p_credits_to_add, 0, 0)
  ON CONFLICT (user_id) DO UPDATE SET
    credits_balance = customers.credits_balance + p_credits_to_add,
    updated_at = now()
  RETURNING credits_balance INTO v_new_balance;

  RETURN json_build_object(
    'success', true,
    'message', format('%s credits added', p_credits_to_add),
    'credits_added', p_credits_to_add,
    'new_balance', v_new_balance
  );
END;
$$;
