-- ============================================
-- WhoGoes Customer Dashboard - Tables
-- Run this in Supabase SQL Editor
-- ============================================

-- TABLE 1: user_signups
-- Records every new signup with 20 free trial credits.
-- Rows are created lazily (on first dashboard access via RPC),
-- NOT via trigger on auth.users — avoids signup errors.
CREATE TABLE IF NOT EXISTS user_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  free_credits INTEGER NOT NULL DEFAULT 20,
  signed_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_signups_user_unique UNIQUE (user_id),
  CONSTRAINT user_signups_credits_non_negative CHECK (free_credits >= 0)
);

ALTER TABLE user_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own signup"
  ON user_signups FOR SELECT
  USING (auth.uid() = user_id);


-- TABLE 2: customers
-- Tracks paying users: purchased credit balance, lifetime spend, etc.
-- Rows are created when a user makes their first payment.
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_balance INTEGER NOT NULL DEFAULT 0,
  total_purchased_credits INTEGER NOT NULL DEFAULT 0,
  total_paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  last_payment_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customers_user_unique UNIQUE (user_id),
  CONSTRAINT customers_balance_non_negative CHECK (credits_balance >= 0)
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own customer record"
  ON customers FOR SELECT
  USING (auth.uid() = user_id);


-- Migration: Copy existing customer_credits data into user_signups
-- (Only runs once; ON CONFLICT prevents duplicates on re-run)
INSERT INTO user_signups (user_id, free_credits, signed_up_at)
SELECT user_id, balance, created_at FROM customer_credits
ON CONFLICT (user_id) DO NOTHING;

-- Drop old trigger and function (safe to re-run)
DROP TRIGGER IF EXISTS on_auth_user_created_credits ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user_credits();
-- Note: DROP TABLE customer_credits only after confirming migration.
-- Uncomment when ready: DROP TABLE IF EXISTS customer_credits;


-- TABLE 3: customer_event_subscriptions
-- Tracks which events a customer has subscribed to.
CREATE TABLE IF NOT EXISTS customer_event_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_paused BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT ces_user_event_unique UNIQUE (user_id, event_id)
);

ALTER TABLE customer_event_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscriptions"
  ON customer_event_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ces_user ON customer_event_subscriptions (user_id);


-- TABLE 4: customer_contact_access
-- Tracks which contacts a customer has been charged for (1 credit = 1 row).
-- is_downloaded: false = "New Lead", true = "Processed"
CREATE TABLE IF NOT EXISTS customer_contact_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  charged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_downloaded BOOLEAN NOT NULL DEFAULT false,
  downloaded_at TIMESTAMPTZ,
  CONSTRAINT cca_unique UNIQUE (user_id, contact_id, event_id)
);

ALTER TABLE customer_contact_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own access"
  ON customer_contact_access FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own access"
  ON customer_contact_access FOR UPDATE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_cca_user_event ON customer_contact_access (user_id, event_id);
