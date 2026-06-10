-- Widen affiliate email-attribution window from 7 days to 30 days.
-- A submitted email now attributes a signup if the user registered within
-- 30 days before or after the day the affiliate added the email.
-- The back-check in affiliate_add_contacts is widened to match.

-- ---------------------------------------------------------------------
-- match_affiliate_for_signup: 30-day attribution window
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

  -- (1) Email match: earliest eligible contact within the +/-30 day window.
  SELECT c.id AS contact_id, c.affiliate_id INTO v_contact
  FROM affiliate_contacts c
  JOIN affiliates a ON a.id = c.affiliate_id
  WHERE c.email_normalized = v_email_norm
    AND a.status = 'active'
    AND a.user_id <> p_user_id
    AND c.status = 'pending'
    AND c.added_at BETWEEN v_signup - INTERVAL '30 days'
                       AND v_signup + INTERVAL '30 days'
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
-- affiliate_add_contacts: back-check window widened to 30 days
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

  -- Back-check: attribute any user who signed up in the last 30 days with one of these emails.
  FOR v_rec IN
    SELECT u.id AS uid, u.email
    FROM auth.users u
    WHERE lower(u.email) = ANY (v_norm)
      AND u.created_at >= now() - INTERVAL '30 days'
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

REVOKE ALL ON FUNCTION match_affiliate_for_signup(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_affiliate_for_signup(uuid, text, text) TO service_role;
