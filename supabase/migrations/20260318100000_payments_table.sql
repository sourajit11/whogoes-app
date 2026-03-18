-- Payments table to track all Razorpay transactions
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  razorpay_order_id TEXT NOT NULL UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  razorpay_signature TEXT,
  amount_usd DECIMAL(10,2) NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  credits INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',  -- created | paid | failed
  package_name TEXT,                       -- starter | growth | pro
  created_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: Users can only read their own payments
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own payments" ON payments
  FOR SELECT USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_order_id ON payments(razorpay_order_id);

-- RPC: Complete a verified payment and add credits
CREATE OR REPLACE FUNCTION complete_payment(
  p_razorpay_order_id TEXT,
  p_razorpay_payment_id TEXT,
  p_razorpay_signature TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_payment RECORD;
  v_new_balance INTEGER;
BEGIN
  -- Find and validate the payment (must belong to current user and be in 'created' status)
  SELECT * INTO v_payment FROM payments
    WHERE razorpay_order_id = p_razorpay_order_id
    AND user_id = auth.uid()
    AND status = 'created';

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', 'Payment not found or already processed');
  END IF;

  -- Mark payment as paid
  UPDATE payments SET
    razorpay_payment_id = p_razorpay_payment_id,
    razorpay_signature = p_razorpay_signature,
    status = 'paid',
    paid_at = now(),
    updated_at = now()
  WHERE id = v_payment.id;

  -- Upsert into customers table (add credits + track revenue)
  INSERT INTO customers (user_id, credits_balance, total_purchased_credits, total_paid_amount, last_payment_at)
  VALUES (auth.uid(), v_payment.credits, v_payment.credits, v_payment.amount_usd, now())
  ON CONFLICT (user_id) DO UPDATE SET
    credits_balance = customers.credits_balance + v_payment.credits,
    total_purchased_credits = customers.total_purchased_credits + v_payment.credits,
    total_paid_amount = customers.total_paid_amount + v_payment.amount_usd,
    last_payment_at = now(),
    updated_at = now();

  -- Get new total balance (free + paid)
  SELECT COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0)
  INTO v_new_balance
  FROM auth.users u
  LEFT JOIN user_signups us ON us.user_id = u.id
  LEFT JOIN customers c ON c.user_id = u.id
  WHERE u.id = auth.uid();

  RETURN json_build_object(
    'success', true,
    'message', 'Payment successful! Credits added.',
    'credits_added', v_payment.credits,
    'new_balance', v_new_balance
  );
END;
$$;
