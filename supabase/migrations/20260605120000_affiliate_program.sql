-- =====================================================================
-- Affiliate Program: tables, RLS, attribution engine, commission accrual,
-- affiliate-facing RPCs, and admin RPCs/views.
--
-- Model: affiliates refer WhoGoes users via (a) a referral link (cookie)
-- or (b) submitting prospect emails matched within a 7-day window. Every
-- credit purchase a referred user makes accrues 30% commission, forever.
-- Manual payout ledger with a $100 minimum. See plan + /affiliates page.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- PART 1: Tables
-- ---------------------------------------------------------------------

CREATE TABLE affiliates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status              TEXT NOT NULL DEFAULT 'pending',  -- pending | active | suspended
  referral_code       TEXT UNIQUE,                      -- null until approved
  display_name        TEXT,
  payout_method       TEXT,                             -- e.g. paypal | bank | wise
  payout_details      JSONB,                            -- where to send money
  pending_balance_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  paid_balance_usd    NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_earned_usd    NUMERIC(10,2) NOT NULL DEFAULT 0,
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Submitted prospect emails (one of the two attribution methods)
CREATE TABLE affiliate_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id    UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  email_normalized TEXT NOT NULL,                       -- lower(trim(email))
  email_original  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',      -- pending | matched | expired
  matched_user_id UUID REFERENCES auth.users(id),
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  matched_at      TIMESTAMPTZ,
  UNIQUE (affiliate_id, email_normalized)
);
CREATE INDEX idx_affiliate_contacts_email ON affiliate_contacts(email_normalized);
CREATE INDEX idx_affiliate_contacts_affiliate ON affiliate_contacts(affiliate_id);

-- One row per referred user (the confirmed attribution). UNIQUE referred_user
-- guarantees first-touch wins and a user can only ever belong to one affiliate.
CREATE TABLE affiliate_referrals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id      UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  referred_user_id  UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_email    TEXT,
  source            TEXT NOT NULL,                       -- email_match | link
  contact_id        UUID REFERENCES affiliate_contacts(id),
  referred_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_purchase_at TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'active'       -- active | voided
);
CREATE INDEX idx_affiliate_referrals_affiliate ON affiliate_referrals(affiliate_id);

-- One row per qualifying payment. UNIQUE payment_id makes accrual idempotent.
CREATE TABLE affiliate_payouts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  amount_usd   NUMERIC(10,2) NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',          -- pending | paid
  method       TEXT,
  reference    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at      TIMESTAMPTZ
);
CREATE INDEX idx_affiliate_payouts_affiliate ON affiliate_payouts(affiliate_id);

CREATE TABLE affiliate_commissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id     UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  referral_id      UUID NOT NULL REFERENCES affiliate_referrals(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES auth.users(id),
  payment_id       UUID NOT NULL UNIQUE REFERENCES payments(id),
  amount_usd       NUMERIC(10,2) NOT NULL,
  commission_usd   NUMERIC(10,2) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',       -- pending | paid | voided
  payout_id        UUID REFERENCES affiliate_payouts(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_affiliate_commissions_affiliate ON affiliate_commissions(affiliate_id);

-- ---------------------------------------------------------------------
-- PART 2: RLS — affiliates read only their own rows. No client writes
-- (all mutations go through the SECURITY DEFINER RPCs below).
-- ---------------------------------------------------------------------

ALTER TABLE affiliates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_contacts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_referrals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_payouts    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Affiliates read own row" ON affiliates
  FOR SELECT USING ((select auth.uid()) = user_id);

CREATE POLICY "Affiliates read own contacts" ON affiliate_contacts
  FOR SELECT USING (affiliate_id IN (
    SELECT id FROM affiliates WHERE user_id = (select auth.uid())
  ));

CREATE POLICY "Affiliates read own referrals" ON affiliate_referrals
  FOR SELECT USING (affiliate_id IN (
    SELECT id FROM affiliates WHERE user_id = (select auth.uid())
  ));

CREATE POLICY "Affiliates read own commissions" ON affiliate_commissions
  FOR SELECT USING (affiliate_id IN (
    SELECT id FROM affiliates WHERE user_id = (select auth.uid())
  ));

CREATE POLICY "Affiliates read own payouts" ON affiliate_payouts
  FOR SELECT USING (affiliate_id IN (
    SELECT id FROM affiliates WHERE user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------
-- PART 3: Helpers
-- ---------------------------------------------------------------------

-- Mask an email for display to affiliates on link-based (anonymous) signups.
CREATE OR REPLACE FUNCTION mask_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = 'public'
AS $$
  SELECT CASE
    WHEN p_email IS NULL OR position('@' IN p_email) = 0 THEN NULL
    ELSE left(split_part(p_email, '@', 1), 1) || '****@' || split_part(p_email, '@', 2)
  END;
$$;

-- ---------------------------------------------------------------------
-- PART 4: Attribution engine (internal — service_role only)
-- ---------------------------------------------------------------------

-- Attribute a (possibly already-signed-up) user to an affiliate.
-- Priority: email match first (earliest contact within +/-7 days wins),
-- then referral link. UNIQUE(referred_user_id) enforces one attribution.
CREATE OR REPLACE FUNCTION match_affiliate_for_signup(
  p_user_id UUID,
  p_email TEXT,
  p_referral_code TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_email_norm TEXT;
  v_signup     TIMESTAMPTZ;
  v_existing   UUID;
  v_contact    RECORD;
  v_affiliate  RECORD;
  v_inserted   UUID;
BEGIN
  IF p_user_id IS NULL OR p_email IS NULL THEN
    RETURN NULL;
  END IF;

  -- Idempotent: already attributed?
  SELECT affiliate_id INTO v_existing
  FROM affiliate_referrals WHERE referred_user_id = p_user_id;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_email_norm := lower(trim(p_email));
  SELECT created_at INTO v_signup FROM auth.users WHERE id = p_user_id;
  v_signup := COALESCE(v_signup, now());

  -- (1) Email match — earliest eligible contact within the +/-7 day window.
  SELECT c.id AS contact_id, c.affiliate_id INTO v_contact
  FROM affiliate_contacts c
  JOIN affiliates a ON a.id = c.affiliate_id
  WHERE c.email_normalized = v_email_norm
    AND a.status = 'active'
    AND a.user_id <> p_user_id                       -- no self-referral
    AND c.status = 'pending'
    AND c.added_at BETWEEN v_signup - INTERVAL '7 days'
                       AND v_signup + INTERVAL '7 days'
  ORDER BY c.added_at ASC
  LIMIT 1;

  IF v_contact.affiliate_id IS NOT NULL THEN
    INSERT INTO affiliate_referrals
      (affiliate_id, referred_user_id, referred_email, source, contact_id)
    VALUES
      (v_contact.affiliate_id, p_user_id, p_email, 'email_match', v_contact.contact_id)
    ON CONFLICT (referred_user_id) DO NOTHING
    RETURNING affiliate_id INTO v_inserted;

    IF v_inserted IS NOT NULL THEN
      UPDATE affiliate_contacts
        SET status = 'matched', matched_user_id = p_user_id, matched_at = now()
        WHERE id = v_contact.contact_id;
      RETURN v_inserted;
    END IF;
  END IF;

  -- (2) Referral link.
  IF p_referral_code IS NOT NULL AND length(trim(p_referral_code)) > 0 THEN
    SELECT id, user_id INTO v_affiliate
    FROM affiliates
    WHERE referral_code = upper(trim(p_referral_code))
      AND status = 'active'
    LIMIT 1;

    IF v_affiliate.id IS NOT NULL AND v_affiliate.user_id <> p_user_id THEN
      INSERT INTO affiliate_referrals
        (affiliate_id, referred_user_id, referred_email, source)
      VALUES
        (v_affiliate.id, p_user_id, p_email, 'link')
      ON CONFLICT (referred_user_id) DO NOTHING
      RETURNING affiliate_id INTO v_inserted;
      RETURN v_inserted;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- Accrue 30% commission for a paid purchase. Idempotent on payment_id.
-- Called from inside complete_payment() in a guarded block.
CREATE OR REPLACE FUNCTION accrue_affiliate_commission(
  p_payment_id UUID,
  p_user_id UUID,
  p_amount_usd NUMERIC
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_ref     RECORD;
  v_comm    NUMERIC(10,2);
  v_new_id  UUID;
BEGIN
  SELECT id, affiliate_id INTO v_ref
  FROM affiliate_referrals
  WHERE referred_user_id = p_user_id AND status = 'active'
  LIMIT 1;

  IF v_ref.id IS NULL THEN
    RETURN;
  END IF;

  v_comm := round(p_amount_usd * 0.30, 2);

  INSERT INTO affiliate_commissions
    (affiliate_id, referral_id, referred_user_id, payment_id, amount_usd, commission_usd)
  VALUES
    (v_ref.affiliate_id, v_ref.id, p_user_id, p_payment_id, p_amount_usd, v_comm)
  ON CONFLICT (payment_id) DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    UPDATE affiliates
      SET pending_balance_usd = pending_balance_usd + v_comm,
          total_earned_usd    = total_earned_usd + v_comm,
          updated_at = now()
      WHERE id = v_ref.affiliate_id;

    UPDATE affiliate_referrals
      SET first_purchase_at = COALESCE(first_purchase_at, now())
      WHERE id = v_ref.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION match_affiliate_for_signup(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_affiliate_for_signup(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION accrue_affiliate_commission(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accrue_affiliate_commission(uuid, uuid, numeric) TO service_role;

-- ---------------------------------------------------------------------
-- PART 5: Hook commission accrual into the existing payment flow.
-- CREATE OR REPLACE preserving the body of 20260318100000_payments_table.sql,
-- adding a guarded PERFORM so affiliate logic can never break a purchase.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION complete_payment(
  p_razorpay_order_id TEXT,
  p_razorpay_payment_id TEXT,
  p_razorpay_signature TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_payment RECORD;
  v_new_balance INTEGER;
BEGIN
  SELECT * INTO v_payment FROM payments
    WHERE razorpay_order_id = p_razorpay_order_id
    AND user_id = auth.uid()
    AND status = 'created';

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', 'Payment not found or already processed');
  END IF;

  UPDATE payments SET
    razorpay_payment_id = p_razorpay_payment_id,
    razorpay_signature = p_razorpay_signature,
    status = 'paid',
    paid_at = now(),
    updated_at = now()
  WHERE id = v_payment.id;

  INSERT INTO customers (user_id, credits_balance, total_purchased_credits, total_paid_amount, last_payment_at)
  VALUES (auth.uid(), v_payment.credits, v_payment.credits, v_payment.amount_usd, now())
  ON CONFLICT (user_id) DO UPDATE SET
    credits_balance = customers.credits_balance + v_payment.credits,
    total_purchased_credits = customers.total_purchased_credits + v_payment.credits,
    total_paid_amount = customers.total_paid_amount + v_payment.amount_usd,
    last_payment_at = now(),
    updated_at = now();

  -- Affiliate commission accrual. Never allowed to break the payment.
  BEGIN
    PERFORM accrue_affiliate_commission(v_payment.id, auth.uid(), v_payment.amount_usd);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'affiliate commission accrual failed: %', SQLERRM;
  END;

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

-- ---------------------------------------------------------------------
-- PART 6: Affiliate-facing RPCs (auth.uid()-scoped; safe for authenticated)
-- ---------------------------------------------------------------------

-- Create/return a pending affiliate row for the current user.
CREATE OR REPLACE FUNCTION affiliate_apply(p_display_name TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_aff RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  INSERT INTO affiliates (user_id, display_name)
  VALUES (v_uid, NULLIF(trim(p_display_name), ''))
  ON CONFLICT (user_id) DO UPDATE SET
    display_name = COALESCE(NULLIF(trim(p_display_name), ''), affiliates.display_name),
    updated_at = now()
  RETURNING * INTO v_aff;

  RETURN json_build_object('success', true, 'status', v_aff.status);
END;
$$;

-- Add prospect emails. Inserts as pending, then back-checks recent signups
-- (within the last 7 days) and immediately attributes any match.
CREATE OR REPLACE FUNCTION affiliate_add_contacts(p_emails TEXT[])
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_aff       RECORD;
  v_own_email TEXT;
  v_norm      TEXT[];
  v_email     TEXT;
  v_added     INT := 0;
  v_dupes     INT := 0;
  v_matched   INT := 0;
  v_today     INT;
  v_rec       RECORD;
BEGIN
  SELECT * INTO v_aff FROM affiliates WHERE user_id = v_uid;
  IF v_aff.id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not an affiliate');
  END IF;
  IF v_aff.status <> 'active' THEN
    RETURN json_build_object('success', false, 'message', 'Affiliate account is not active yet');
  END IF;

  -- Soft cap: 500 contacts per rolling day.
  SELECT count(*) INTO v_today FROM affiliate_contacts
    WHERE affiliate_id = v_aff.id AND added_at >= now() - INTERVAL '1 day';

  SELECT lower(email) INTO v_own_email FROM auth.users WHERE id = v_uid;

  -- Normalize + dedupe input.
  SELECT array_agg(DISTINCT lower(trim(e))) INTO v_norm
  FROM unnest(p_emails) AS e
  WHERE trim(e) <> '' AND position('@' IN e) > 0;

  IF v_norm IS NULL THEN
    RETURN json_build_object('success', true, 'added', 0, 'duplicates', 0, 'matched', 0);
  END IF;

  FOREACH v_email IN ARRAY v_norm LOOP
    IF v_email = v_own_email THEN
      CONTINUE;  -- block self-referral
    END IF;
    IF v_today + v_added >= 500 THEN
      EXIT;       -- hit daily soft cap
    END IF;

    INSERT INTO affiliate_contacts (affiliate_id, email_normalized, email_original)
    VALUES (v_aff.id, v_email, v_email)
    ON CONFLICT (affiliate_id, email_normalized) DO NOTHING;

    IF FOUND THEN
      v_added := v_added + 1;
    ELSE
      v_dupes := v_dupes + 1;
    END IF;
  END LOOP;

  -- Back-check: any user who signed up in the last 7 days with one of these
  -- emails should be attributed now (first-touch logic lives in the matcher).
  FOR v_rec IN
    SELECT u.id AS uid, u.email
    FROM auth.users u
    WHERE lower(u.email) = ANY (v_norm)
      AND u.created_at >= now() - INTERVAL '7 days'
  LOOP
    PERFORM match_affiliate_for_signup(v_rec.uid, v_rec.email, NULL);
  END LOOP;

  SELECT count(*) INTO v_matched
  FROM affiliate_contacts
  WHERE affiliate_id = v_aff.id
    AND status = 'matched'
    AND email_normalized = ANY (v_norm);

  RETURN json_build_object(
    'success', true,
    'added', v_added,
    'duplicates', v_dupes,
    'matched', v_matched,
    'capped', (v_today + v_added >= 500)
  );
END;
$$;

CREATE OR REPLACE FUNCTION affiliate_update_payout(p_method TEXT, p_details JSONB)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  UPDATE affiliates
    SET payout_method = NULLIF(trim(p_method), ''),
        payout_details = p_details,
        updated_at = now()
    WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', 'Not an affiliate');
  END IF;
  RETURN json_build_object('success', true);
END;
$$;

-- Everything the affiliate dashboard needs in one JSON blob.
CREATE OR REPLACE FUNCTION affiliate_get_dashboard()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_aff RECORD;
BEGIN
  SELECT * INTO v_aff FROM affiliates WHERE user_id = v_uid;
  IF v_aff.id IS NULL THEN
    RETURN json_build_object('status', 'none');
  END IF;

  RETURN json_build_object(
    'status', v_aff.status,
    'referral_code', v_aff.referral_code,
    'display_name', v_aff.display_name,
    'payout_method', v_aff.payout_method,
    'payout_details', v_aff.payout_details,
    'pending_balance_usd', v_aff.pending_balance_usd,
    'paid_balance_usd', v_aff.paid_balance_usd,
    'total_earned_usd', v_aff.total_earned_usd,
    'payout_threshold_usd', 100,
    'signups', (SELECT count(*) FROM affiliate_referrals WHERE affiliate_id = v_aff.id),
    'paying_customers', (SELECT count(DISTINCT referred_user_id) FROM affiliate_commissions WHERE affiliate_id = v_aff.id AND status <> 'voided'),
    'referrals', COALESCE((
      SELECT json_agg(r ORDER BY r.referred_at DESC) FROM (
        SELECT
          rf.id,
          CASE WHEN rf.source = 'email_match' THEN rf.referred_email
               ELSE mask_email(rf.referred_email) END AS email,
          rf.source,
          rf.status,
          rf.referred_at,
          rf.first_purchase_at,
          (SELECT COALESCE(sum(commission_usd), 0) FROM affiliate_commissions c
             WHERE c.referral_id = rf.id AND c.status <> 'voided') AS earned_usd
        FROM affiliate_referrals rf
        WHERE rf.affiliate_id = v_aff.id
        ORDER BY rf.referred_at DESC
        LIMIT 100
      ) r
    ), '[]'::json),
    'contacts', COALESCE((
      SELECT json_agg(c ORDER BY c.added_at DESC) FROM (
        SELECT email_original AS email, status, added_at, matched_at
        FROM affiliate_contacts
        WHERE affiliate_id = v_aff.id
        ORDER BY added_at DESC
        LIMIT 200
      ) c
    ), '[]'::json),
    'commissions', COALESCE((
      SELECT json_agg(c ORDER BY c.created_at DESC) FROM (
        SELECT amount_usd, commission_usd, status, created_at
        FROM affiliate_commissions
        WHERE affiliate_id = v_aff.id
        ORDER BY created_at DESC
        LIMIT 100
      ) c
    ), '[]'::json),
    'payouts', COALESCE((
      SELECT json_agg(p ORDER BY p.created_at DESC) FROM (
        SELECT amount_usd, status, method, reference, created_at, paid_at
        FROM affiliate_payouts
        WHERE affiliate_id = v_aff.id
        ORDER BY created_at DESC
      ) p
    ), '[]'::json)
  );
END;
$$;

-- ---------------------------------------------------------------------
-- PART 7: Admin view + RPCs (service_role only — never authenticated)
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW admin_affiliate_overview AS
SELECT
  a.id AS affiliate_id,
  a.user_id,
  u.email,
  a.display_name,
  a.status,
  a.referral_code,
  a.pending_balance_usd,
  a.paid_balance_usd,
  a.total_earned_usd,
  a.created_at,
  a.approved_at,
  (SELECT count(*) FROM affiliate_referrals r WHERE r.affiliate_id = a.id) AS referral_count,
  (SELECT count(DISTINCT c.referred_user_id) FROM affiliate_commissions c
     WHERE c.affiliate_id = a.id AND c.status <> 'voided') AS paying_count,
  (SELECT max(r.referred_at) FROM affiliate_referrals r WHERE r.affiliate_id = a.id) AS last_referral_at
FROM affiliates a
JOIN auth.users u ON u.id = a.user_id;

REVOKE ALL ON admin_affiliate_overview FROM anon, authenticated;
GRANT SELECT ON admin_affiliate_overview TO service_role;

-- Full detail for one affiliate.
CREATE OR REPLACE FUNCTION admin_get_affiliate_detail(p_affiliate_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_aff RECORD;
  v_email TEXT;
BEGIN
  SELECT * INTO v_aff FROM affiliates WHERE id = p_affiliate_id;
  IF v_aff.id IS NULL THEN
    RETURN json_build_object('error', 'not found');
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_aff.user_id;

  RETURN json_build_object(
    'affiliate', json_build_object(
      'id', v_aff.id, 'email', v_email, 'display_name', v_aff.display_name,
      'status', v_aff.status, 'referral_code', v_aff.referral_code,
      'pending_balance_usd', v_aff.pending_balance_usd,
      'paid_balance_usd', v_aff.paid_balance_usd,
      'total_earned_usd', v_aff.total_earned_usd,
      'payout_method', v_aff.payout_method, 'payout_details', v_aff.payout_details,
      'created_at', v_aff.created_at, 'approved_at', v_aff.approved_at
    ),
    'referrals', COALESCE((
      SELECT json_agg(r ORDER BY r.referred_at DESC) FROM (
        SELECT rf.id, rf.referred_email AS email, rf.source, rf.status,
               rf.referred_at, rf.first_purchase_at,
               (SELECT COALESCE(sum(commission_usd),0) FROM affiliate_commissions c
                  WHERE c.referral_id = rf.id AND c.status <> 'voided') AS earned_usd
        FROM affiliate_referrals rf WHERE rf.affiliate_id = p_affiliate_id
        ORDER BY rf.referred_at DESC
      ) r
    ), '[]'::json),
    'commissions', COALESCE((
      SELECT json_agg(c ORDER BY c.created_at DESC) FROM (
        SELECT id, amount_usd, commission_usd, status, created_at
        FROM affiliate_commissions WHERE affiliate_id = p_affiliate_id
        ORDER BY created_at DESC
      ) c
    ), '[]'::json),
    'contacts', COALESCE((
      SELECT json_agg(c ORDER BY c.added_at DESC) FROM (
        SELECT email_original AS email, status, added_at, matched_at
        FROM affiliate_contacts WHERE affiliate_id = p_affiliate_id
        ORDER BY added_at DESC LIMIT 500
      ) c
    ), '[]'::json),
    'payouts', COALESCE((
      SELECT json_agg(p ORDER BY p.created_at DESC) FROM (
        SELECT id, amount_usd, status, method, reference, created_at, paid_at
        FROM affiliate_payouts WHERE affiliate_id = p_affiliate_id
        ORDER BY created_at DESC
      ) p
    ), '[]'::json)
  );
END;
$$;

-- Approve a pending affiliate: activate + assign a unique referral code.
CREATE OR REPLACE FUNCTION admin_approve_affiliate(p_affiliate_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_code TEXT;
  v_aff RECORD;
BEGIN
  SELECT * INTO v_aff FROM affiliates WHERE id = p_affiliate_id;
  IF v_aff.id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Affiliate not found');
  END IF;

  v_code := v_aff.referral_code;
  IF v_code IS NULL THEN
    LOOP
      v_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM affiliates WHERE referral_code = v_code);
    END LOOP;
  END IF;

  UPDATE affiliates
    SET status = 'active',
        referral_code = v_code,
        approved_at = COALESCE(approved_at, now()),
        updated_at = now()
    WHERE id = p_affiliate_id;

  RETURN json_build_object('success', true, 'referral_code', v_code);
END;
$$;

CREATE OR REPLACE FUNCTION admin_suspend_affiliate(p_affiliate_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE affiliates SET status = 'suspended', updated_at = now()
    WHERE id = p_affiliate_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', 'Affiliate not found');
  END IF;
  RETURN json_build_object('success', true);
END;
$$;

-- Record a manual payout for the affiliate's entire current pending balance.
CREATE OR REPLACE FUNCTION admin_mark_payout_paid(
  p_affiliate_id UUID,
  p_method TEXT,
  p_reference TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_amount NUMERIC(10,2);
  v_payout_id UUID;
BEGIN
  SELECT pending_balance_usd INTO v_amount FROM affiliates WHERE id = p_affiliate_id;
  IF v_amount IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Affiliate not found');
  END IF;
  IF v_amount <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'No pending balance to pay out');
  END IF;

  INSERT INTO affiliate_payouts (affiliate_id, amount_usd, status, method, reference, paid_at)
  VALUES (p_affiliate_id, v_amount, 'paid', NULLIF(trim(p_method), ''), NULLIF(trim(p_reference), ''), now())
  RETURNING id INTO v_payout_id;

  UPDATE affiliate_commissions
    SET status = 'paid', payout_id = v_payout_id
    WHERE affiliate_id = p_affiliate_id AND status = 'pending';

  UPDATE affiliates
    SET paid_balance_usd = paid_balance_usd + v_amount,
        pending_balance_usd = 0,
        updated_at = now()
    WHERE id = p_affiliate_id;

  RETURN json_build_object('success', true, 'amount_usd', v_amount);
END;
$$;

-- Void a pending commission (fraud control); reverses the affiliate balance.
CREATE OR REPLACE FUNCTION admin_void_commission(p_commission_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_comm RECORD;
BEGIN
  SELECT * INTO v_comm FROM affiliate_commissions WHERE id = p_commission_id;
  IF v_comm.id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Commission not found');
  END IF;
  IF v_comm.status <> 'pending' THEN
    RETURN json_build_object('success', false, 'message', 'Only pending commissions can be voided');
  END IF;

  UPDATE affiliate_commissions SET status = 'voided' WHERE id = p_commission_id;
  UPDATE affiliates
    SET pending_balance_usd = pending_balance_usd - v_comm.commission_usd,
        total_earned_usd = total_earned_usd - v_comm.commission_usd,
        updated_at = now()
    WHERE id = v_comm.affiliate_id;

  RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION admin_get_affiliate_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_affiliate_detail(uuid) TO service_role;
REVOKE ALL ON FUNCTION admin_approve_affiliate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_approve_affiliate(uuid) TO service_role;
REVOKE ALL ON FUNCTION admin_suspend_affiliate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_suspend_affiliate(uuid) TO service_role;
REVOKE ALL ON FUNCTION admin_mark_payout_paid(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_mark_payout_paid(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION admin_void_commission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_void_commission(uuid) TO service_role;

COMMIT;
