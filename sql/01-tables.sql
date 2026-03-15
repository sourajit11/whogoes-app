-- ============================================
-- WhoGoes Customer Dashboard - New Tables
-- Run this in Supabase SQL Editor
-- ============================================

-- TABLE 1: customer_credits
-- Tracks credit balance per authenticated user.
-- New users start with 20 credits.
CREATE TABLE customer_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_credits_user_unique UNIQUE (user_id),
  CONSTRAINT customer_credits_balance_non_negative CHECK (balance >= 0)
);

ALTER TABLE customer_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own credits"
  ON customer_credits FOR SELECT
  USING (auth.uid() = user_id);

-- Auto-create credits row when a new user signs up
CREATE OR REPLACE FUNCTION handle_new_user_credits()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO customer_credits (user_id, balance)
  VALUES (NEW.id, 20)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block user creation if credits insert fails
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created_credits
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user_credits();

-- One-time migration: give existing users 20 credits
INSERT INTO customer_credits (user_id, balance)
SELECT id, 20 FROM auth.users
ON CONFLICT (user_id) DO NOTHING;


-- TABLE 2: customer_event_subscriptions
-- Tracks which events a customer has subscribed to.
CREATE TABLE customer_event_subscriptions (
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

CREATE INDEX idx_ces_user ON customer_event_subscriptions (user_id);


-- TABLE 3: customer_contact_access
-- Tracks which contacts a customer has been charged for (1 credit = 1 row).
-- is_downloaded: false = "New Lead", true = "Processed"
CREATE TABLE customer_contact_access (
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

CREATE INDEX idx_cca_user_event ON customer_contact_access (user_id, event_id);
