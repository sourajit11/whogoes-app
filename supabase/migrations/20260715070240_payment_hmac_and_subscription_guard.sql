-- Follow-up to 20260715065407 security hardening.
-- The currently deployed app still calls complete_payment(text,text,text) and
-- api_upsert_subscription via the user's session, so both must stay callable
-- by authenticated WITHOUT reopening the holes:
--
-- 1. complete_payment(3-arg): now verifies the Razorpay HMAC-SHA256 signature
--    INSIDE Postgres (pgcrypto) against a secret held in the non-exposed
--    `private` schema, then delegates to the 4-arg service-role version using
--    auth.uid(). A forged signature is rejected even when the function is
--    called directly via PostgREST, which closes the free-credits exploit.
-- 2. api_upsert_subscription: rejects p_user_id <> auth.uid() unless called
--    by service_role (auth.uid() IS NULL), so an authenticated user can no
--    longer write another user's subscription.
--
-- NOTE: the actual secret value is inserted operationally (not in this file):
--   INSERT INTO private.app_secrets(key, value) VALUES ('razorpay_key_secret', '<RAZORPAY_KEY_SECRET>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON private.app_secrets FROM PUBLIC, anon, authenticated;

-- 3-arg complete_payment: HMAC-verify, then delegate as the session user.
CREATE OR REPLACE FUNCTION public.complete_payment(
  p_razorpay_order_id text,
  p_razorpay_payment_id text,
  p_razorpay_signature text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_secret text;
  v_expected text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  SELECT value INTO v_secret FROM private.app_secrets WHERE key = 'razorpay_key_secret';
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'razorpay secret not configured';
  END IF;

  v_expected := encode(
    extensions.hmac(
      convert_to(p_razorpay_order_id || '|' || p_razorpay_payment_id, 'utf8'),
      convert_to(v_secret, 'utf8'),
      'sha256'
    ),
    'hex'
  );

  IF v_expected <> p_razorpay_signature THEN
    RETURN json_build_object('success', false, 'message', 'Payment verification failed');
  END IF;

  RETURN public.complete_payment(auth.uid(), p_razorpay_order_id, p_razorpay_payment_id, p_razorpay_signature);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.complete_payment(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_payment(text, text, text) TO authenticated, service_role;

-- api_upsert_subscription: bind p_user_id to the caller for non-service
-- roles. Body otherwise identical to the live version; only the guard at the
-- top is new.
CREATE OR REPLACE FUNCTION public.api_upsert_subscription(p_user_id uuid, p_event_id uuid, p_auto_unlock_enabled boolean DEFAULT NULL::boolean, p_max_unlocks_per_event integer DEFAULT NULL::integer, p_is_paused boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row customer_event_subscriptions%ROWTYPE;
BEGIN
  -- Sessions may only write their own subscription; service_role
  -- (auth.uid() IS NULL) may act on behalf of any user.
  IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'p_user_id must match the authenticated user';
  END IF;

  IF p_max_unlocks_per_event IS NOT NULL AND p_max_unlocks_per_event < 0 THEN
    RETURN json_build_object('success', false, 'message', 'max_unlocks_per_event must be >= 0');
  END IF;

  INSERT INTO customer_event_subscriptions (
    user_id, event_id, auto_unlock_enabled, max_unlocks_per_event, is_paused
  )
  VALUES (
    p_user_id, p_event_id,
    COALESCE(p_auto_unlock_enabled, false),
    p_max_unlocks_per_event,
    COALESCE(p_is_paused, false)
  )
  ON CONFLICT (user_id, event_id) DO UPDATE SET
    auto_unlock_enabled = COALESCE(p_auto_unlock_enabled, customer_event_subscriptions.auto_unlock_enabled),
    max_unlocks_per_event = COALESCE(p_max_unlocks_per_event, customer_event_subscriptions.max_unlocks_per_event),
    is_paused = COALESCE(p_is_paused, customer_event_subscriptions.is_paused)
  RETURNING * INTO v_row;

  RETURN json_build_object(
    'success', true,
    'subscription', json_build_object(
      'event_id', v_row.event_id,
      'auto_unlock_enabled', v_row.auto_unlock_enabled,
      'max_unlocks_per_event', v_row.max_unlocks_per_event,
      'is_paused', v_row.is_paused,
      'last_api_pulled_at', v_row.last_api_pulled_at,
      'subscribed_at', v_row.subscribed_at
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.api_upsert_subscription(uuid, uuid, boolean, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.api_upsert_subscription(uuid, uuid, boolean, integer, boolean) TO authenticated, service_role;

COMMIT;
