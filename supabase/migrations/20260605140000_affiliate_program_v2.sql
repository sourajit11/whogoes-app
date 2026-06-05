-- =====================================================================
-- Affiliate Program v2: human-friendly referral codes, T&C acceptance,
-- 10/day contact cap with per-affiliate override, 30-day contact expiry,
-- and referral attribution surfaced on the admin customers view.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

BEGIN;

-- ---------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------
ALTER TABLE affiliates
  ADD COLUMN IF NOT EXISTS daily_contact_limit INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version TEXT;

-- ---------------------------------------------------------------------
-- Record T&C acceptance on apply
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION affiliate_apply(p_display_name TEXT, p_accept_terms BOOLEAN DEFAULT FALSE)
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
  IF p_accept_terms IS NOT TRUE THEN
    RETURN json_build_object('success', false, 'message', 'You must accept the Affiliate Program Terms');
  END IF;

  INSERT INTO affiliates (user_id, display_name, terms_accepted_at, terms_version)
  VALUES (v_uid, NULLIF(trim(p_display_name), ''), now(), '2026-06')
  ON CONFLICT (user_id) DO UPDATE SET
    display_name = COALESCE(NULLIF(trim(p_display_name), ''), affiliates.display_name),
    terms_accepted_at = COALESCE(affiliates.terms_accepted_at, now()),
    terms_version = COALESCE(affiliates.terms_version, '2026-06'),
    updated_at = now()
  RETURNING * INTO v_aff;

  RETURN json_build_object('success', true, 'status', v_aff.status);
END;
$$;

-- ---------------------------------------------------------------------
-- Approve affiliate with a human-friendly, name-based referral code
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_approve_affiliate(p_affiliate_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_aff   RECORD;
  v_email TEXT;
  v_meta  TEXT;
  v_base  TEXT;
  v_code  TEXT;
  v_i     INT := 1;
BEGIN
  SELECT * INTO v_aff FROM affiliates WHERE id = p_affiliate_id;
  IF v_aff.id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Affiliate not found');
  END IF;

  v_code := v_aff.referral_code;

  IF v_code IS NULL THEN
    SELECT email, raw_user_meta_data->>'full_name'
      INTO v_email, v_meta
      FROM auth.users WHERE id = v_aff.user_id;

    -- Pick the best available name source, then slugify to first_last.
    v_base := lower(COALESCE(
      NULLIF(trim(v_aff.display_name), ''),
      NULLIF(trim(v_meta), ''),
      split_part(v_email, '@', 1)
    ));
    v_base := regexp_replace(v_base, '[^a-z0-9]+', '_', 'g');
    v_base := trim(both '_' FROM v_base);
    IF v_base = '' THEN
      v_base := 'affiliate';
    END IF;

    -- Ensure uniqueness (case-insensitive): name, name_2, name_3, ...
    v_code := v_base;
    WHILE EXISTS (
      SELECT 1 FROM affiliates
      WHERE lower(referral_code) = v_code AND id <> p_affiliate_id
    ) LOOP
      v_i := v_i + 1;
      v_code := v_base || '_' || v_i;
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

-- ---------------------------------------------------------------------
-- Case-insensitive referral-link matching (so ?ref=jeet_shantikari works
-- and legacy uppercase hex codes still match)
-- ---------------------------------------------------------------------
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
    AND a.user_id <> p_user_id
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

  -- (2) Referral link (case-insensitive).
  IF p_referral_code IS NOT NULL AND length(trim(p_referral_code)) > 0 THEN
    SELECT id, user_id INTO v_affiliate
    FROM affiliates
    WHERE lower(referral_code) = lower(trim(p_referral_code))
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

-- ---------------------------------------------------------------------
-- Contact submissions: per-affiliate daily limit (default 10)
-- ---------------------------------------------------------------------
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
  v_limit     INT;
  v_rec       RECORD;
BEGIN
  SELECT * INTO v_aff FROM affiliates WHERE user_id = v_uid;
  IF v_aff.id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not an affiliate');
  END IF;
  IF v_aff.status <> 'active' THEN
    RETURN json_build_object('success', false, 'message', 'Affiliate account is not active yet');
  END IF;

  v_limit := COALESCE(v_aff.daily_contact_limit, 10);

  SELECT count(*) INTO v_today FROM affiliate_contacts
    WHERE affiliate_id = v_aff.id AND added_at >= now() - INTERVAL '1 day';

  SELECT lower(email) INTO v_own_email FROM auth.users WHERE id = v_uid;

  SELECT array_agg(DISTINCT lower(trim(e))) INTO v_norm
  FROM unnest(p_emails) AS e
  WHERE trim(e) <> '' AND position('@' IN e) > 0;

  IF v_norm IS NULL THEN
    RETURN json_build_object('success', true, 'added', 0, 'duplicates', 0, 'matched', 0,
      'capped', false, 'daily_limit', v_limit, 'used_today', v_today);
  END IF;

  FOREACH v_email IN ARRAY v_norm LOOP
    IF v_email = v_own_email THEN
      CONTINUE;
    END IF;
    IF v_today + v_added >= v_limit THEN
      EXIT;  -- daily limit reached
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

  -- Back-check recent signups for the newly added emails.
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
    'capped', (v_today + v_added >= v_limit),
    'daily_limit', v_limit,
    'used_today', v_today + v_added
  );
END;
$$;

-- ---------------------------------------------------------------------
-- Dashboard: add quota + terms info
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION affiliate_get_dashboard()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_aff RECORD;
  v_today INT;
BEGIN
  SELECT * INTO v_aff FROM affiliates WHERE user_id = v_uid;
  IF v_aff.id IS NULL THEN
    RETURN json_build_object('status', 'none');
  END IF;

  SELECT count(*) INTO v_today FROM affiliate_contacts
    WHERE affiliate_id = v_aff.id AND added_at >= now() - INTERVAL '1 day';

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
    'daily_contact_limit', COALESCE(v_aff.daily_contact_limit, 10),
    'contacts_added_today', v_today,
    'terms_accepted_at', v_aff.terms_accepted_at,
    'signups', (SELECT count(*) FROM affiliate_referrals WHERE affiliate_id = v_aff.id),
    'paying_customers', (SELECT count(DISTINCT referred_user_id) FROM affiliate_commissions WHERE affiliate_id = v_aff.id AND status <> 'voided'),
    'referrals', COALESCE((
      SELECT json_agg(r ORDER BY r.referred_at DESC) FROM (
        SELECT
          rf.id,
          CASE WHEN rf.source = 'email_match' THEN rf.referred_email
               ELSE mask_email(rf.referred_email) END AS email,
          rf.source, rf.status, rf.referred_at, rf.first_purchase_at,
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
-- Admin: set per-affiliate daily contact limit
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_set_contact_limit(p_affiliate_id UUID, p_limit INT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 0 OR p_limit > 1000 THEN
    RETURN json_build_object('success', false, 'message', 'Limit must be between 0 and 1000');
  END IF;
  UPDATE affiliates SET daily_contact_limit = p_limit, updated_at = now()
    WHERE id = p_affiliate_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'message', 'Affiliate not found');
  END IF;
  RETURN json_build_object('success', true, 'daily_contact_limit', p_limit);
END;
$$;

-- ---------------------------------------------------------------------
-- Admin detail: include the affiliate's daily contact limit
-- ---------------------------------------------------------------------
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
      'daily_contact_limit', COALESCE(v_aff.daily_contact_limit, 10),
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

-- ---------------------------------------------------------------------
-- Expire stale unmatched contacts (run daily)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION expire_old_affiliate_contacts()
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = 'public'
AS $$
  UPDATE affiliate_contacts
    SET status = 'expired'
    WHERE status = 'pending'
      AND added_at < now() - INTERVAL '30 days';
$$;

-- ---------------------------------------------------------------------
-- Surface referral attribution on the admin customers view
-- ---------------------------------------------------------------------
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
  last_pkg.package_name AS last_package,
  ref_au.email AS referred_by_email,
  ref_af.referral_code AS referred_by_code,
  r.source AS referral_source
FROM auth.users u
LEFT JOIN user_signups us ON us.user_id = u.id
LEFT JOIN customers c ON c.user_id = u.id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS total_unlocked, MAX(charged_at) AS last_activity
  FROM customer_contact_access GROUP BY user_id
) usage ON usage.user_id = u.id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS event_count
  FROM customer_event_subscriptions GROUP BY user_id
) subs ON subs.user_id = u.id
LEFT JOIN LATERAL (
  SELECT package_name FROM payments
  WHERE payments.user_id = u.id AND payments.status = 'paid'
  ORDER BY payments.paid_at DESC LIMIT 1
) last_pkg ON true
LEFT JOIN affiliate_referrals r ON r.referred_user_id = u.id
LEFT JOIN affiliates ref_af ON ref_af.id = r.affiliate_id
LEFT JOIN auth.users ref_au ON ref_au.id = ref_af.user_id
ORDER BY u.created_at DESC;

REVOKE SELECT ON admin_customer_overview FROM anon, authenticated;
GRANT SELECT ON admin_customer_overview TO service_role;

REVOKE ALL ON FUNCTION admin_set_contact_limit(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_contact_limit(uuid, int) TO service_role;
REVOKE ALL ON FUNCTION expire_old_affiliate_contacts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_old_affiliate_contacts() TO service_role;

COMMIT;

-- Daily expiry job (registered outside the transaction).
SELECT cron.schedule(
  'expire-affiliate-contacts',
  '0 3 * * *',
  $$SELECT public.expire_old_affiliate_contacts()$$
);
