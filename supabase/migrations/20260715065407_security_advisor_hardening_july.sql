-- Security Advisor hardening (2026-07-15).
-- Fixes: 1 rls_disabled_in_public ERROR, 10 security_definer_view ERRORs,
-- 109 anon/authenticated_security_definer_function_executable WARNs,
-- 13 function_search_path_mutable WARNs, 1 materialized_view_in_api WARN,
-- plus the complete_payment signature-bypass vulnerability.
--
-- Model: SECURITY DEFINER functions are service-role-only by default; the
-- user-facing RPC surface is granted back explicitly below. Everything the
-- app calls with the service-role key (admin_*, api_*, pipeline, n8n,
-- scripts) keeps working because service_role is granted explicitly.
-- NOTE: any FUTURE user-facing RPC must ship with an explicit
-- GRANT EXECUTE ... TO authenticated (and anon if public) in its migration,
-- because default privileges below stop auto-granting EXECUTE to PUBLIC.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ERROR rls_disabled_in_public: lookup table exposed without RLS.
--    Enable RLS with no policies = deny anon/authenticated, service_role
--    (BYPASSRLS) and SECURITY DEFINER functions still read it fine.
-- ---------------------------------------------------------------------------
ALTER TABLE public.company_industry_bucket_map ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. ERROR security_definer_view (10 pipeline/n8n views): service-role only.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.v_contacts_for_enrichment_adhoc,
  public.v_contacts_for_enrichment_master,
  public.v_mentioned_stubs_backfill,
  public.v_mentioned_stubs_backfill_active,
  public.v_mentions_pending_adhoc,
  public.v_mentions_pending_master,
  public.v_posts_with_events,
  public.v_posts_with_events_adhoc,
  public.v_sdr_bdr_qualifying_events,
  public.v_shootday_missing_personalization
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.v_contacts_for_enrichment_adhoc,
  public.v_contacts_for_enrichment_master,
  public.v_mentioned_stubs_backfill,
  public.v_mentioned_stubs_backfill_active,
  public.v_mentions_pending_adhoc,
  public.v_mentions_pending_master,
  public.v_posts_with_events,
  public.v_posts_with_events_adhoc,
  public.v_sdr_bdr_qualifying_events,
  public.v_shootday_missing_personalization
TO service_role;

-- ---------------------------------------------------------------------------
-- 3. WARN materialized_view_in_api: admin_data_quality is internal.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.admin_data_quality FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_data_quality TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Replace complete_payment BEFORE the blanket revoke so the new signature
--    is covered by it. The old version stored the Razorpay signature without
--    verifying it and was callable by any authenticated user via PostgREST,
--    letting a logged-in attacker mark their own 'created' payment as paid
--    and mint credits. The new version takes an explicit p_user_id, and only
--    /api/payments/verify (which checks the session AND the HMAC signature)
--    may call it via the service-role client.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_payment(text, text, text);

CREATE FUNCTION public.complete_payment(
  p_user_id uuid,
  p_razorpay_order_id text,
  p_razorpay_payment_id text,
  p_razorpay_signature text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_payment RECORD;
  v_new_balance INTEGER;
BEGIN
  SELECT * INTO v_payment FROM payments
    WHERE razorpay_order_id = p_razorpay_order_id
    AND user_id = p_user_id
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
  VALUES (p_user_id, v_payment.credits, v_payment.credits, v_payment.amount_usd, now())
  ON CONFLICT (user_id) DO UPDATE SET
    credits_balance = customers.credits_balance + v_payment.credits,
    total_purchased_credits = customers.total_purchased_credits + v_payment.credits,
    total_paid_amount = customers.total_paid_amount + v_payment.amount_usd,
    last_payment_at = now(),
    updated_at = now();

  -- Affiliate commission accrual. Never allowed to break the payment.
  BEGIN
    PERFORM accrue_affiliate_commission(v_payment.id, p_user_id, v_payment.amount_usd);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'affiliate commission accrual failed: %', SQLERRM;
  END;

  SELECT COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0)
  INTO v_new_balance
  FROM auth.users u
  LEFT JOIN user_signups us ON us.user_id = u.id
  LEFT JOIN customers c ON c.user_id = u.id
  WHERE u.id = p_user_id;

  RETURN json_build_object(
    'success', true,
    'message', 'Payment successful! Credits added.',
    'credits_added', v_payment.credits,
    'new_balance', v_new_balance
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 5. Lock down EVERY SECURITY DEFINER function in public to service_role.
--    Covers all 109 advisor findings plus any it truncated, and all
--    overloads. User-facing RPCs are granted back in section 6.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END
$do$;

-- ---------------------------------------------------------------------------
-- 6. Grant back the intentional user-facing RPC surface.
--    Every function here derives the caller from auth.uid() internally
--    (or returns non-sensitive preview data by design).
-- ---------------------------------------------------------------------------
-- Public (logged-out) pages: /events/[slug] + OG image.
GRANT EXECUTE ON FUNCTION public.get_event_by_slug(text) TO anon, authenticated;

-- Logged-in dashboard / affiliate portal / billing.
GRANT EXECUTE ON FUNCTION
  public.affiliate_add_contacts(text[]),
  public.affiliate_apply(text),
  public.affiliate_apply(text, boolean),
  public.affiliate_get_dashboard(),
  public.affiliate_update_payout(text, jsonb),
  public.get_customer_credits(),
  public.get_dashboard_overview(),
  public.get_event_filter_facets(uuid, jsonb),
  public.get_event_filter_preview(uuid, jsonb, integer),
  public.get_event_preview(uuid),
  public.get_event_unlock_status(uuid),
  public.get_payment_history(),
  public.get_subscribed_event_contacts(uuid, text, integer, integer, jsonb, text, text),
  public.get_subscribed_events(),
  public.get_usage_history(),
  public.is_api_eligible(uuid),
  public.reveal_event_emails(uuid, uuid[], jsonb),
  public.set_contact_note(uuid, uuid, text),
  public.set_contacts_processed(uuid, uuid[], boolean),
  public.subscribe_to_event(uuid),
  public.unlock_event_contacts(uuid, integer, jsonb, uuid)
TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. WARN function_search_path_mutable: pin search_path on the 13 flagged
--    functions ('public', not '', because bodies use unqualified names).
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.bucket_company_industry(text) SET search_path = public;
ALTER FUNCTION public.bucket_company_size(text, integer) SET search_path = public;
ALTER FUNCTION public.companies_set_buckets() SET search_path = public;
ALTER FUNCTION public.email_go_live() SET search_path = public;
ALTER FUNCTION public.event_role_rank(text) SET search_path = public;
ALTER FUNCTION public.get_event_contact_counts() SET search_path = public;
ALTER FUNCTION public.get_master_active_events() SET search_path = public;
ALTER FUNCTION public.get_master_pending_mentions() SET search_path = public;
ALTER FUNCTION public.get_master_unenriched_contacts() SET search_path = public;
ALTER FUNCTION public.get_paid_subscribed_event_ids() SET search_path = public;
ALTER FUNCTION public.get_whogoes_cold_companies(integer) SET search_path = public;
ALTER FUNCTION public.sdr_bdr_next_companies(integer, text) SET search_path = public;
ALTER FUNCTION public.sdr_bdr_refresh_hosts() SET search_path = public;

-- ---------------------------------------------------------------------------
-- 8. Stop the regression: new functions created by migrations (role
--    postgres) no longer get EXECUTE for PUBLIC automatically. Future
--    user-facing RPCs must GRANT EXECUTE explicitly in their migration.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

COMMIT;
