-- Billing RPCs for payment & usage history

CREATE OR REPLACE FUNCTION get_payment_history()
RETURNS TABLE (
  id UUID,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  amount_usd DECIMAL(10,2),
  currency TEXT,
  credits INTEGER,
  package_name TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT p.id, p.razorpay_order_id, p.razorpay_payment_id, p.amount_usd,
         p.currency, p.credits, p.package_name, p.status, p.created_at, p.paid_at
  FROM payments p
  WHERE p.user_id = auth.uid()
  ORDER BY p.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION get_usage_history()
RETURNS TABLE (
  event_id UUID,
  event_name TEXT,
  credits_used BIGINT,
  unlocked_at TIMESTAMPTZ
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    cca.event_id,
    e.name AS event_name,
    COUNT(cca.id) AS credits_used,
    MIN(cca.charged_at) AS unlocked_at
  FROM customer_contact_access cca
  JOIN events e ON e.id = cca.event_id
  WHERE cca.user_id = auth.uid()
  GROUP BY cca.event_id, e.name
  ORDER BY MIN(cca.charged_at) DESC;
$$;
