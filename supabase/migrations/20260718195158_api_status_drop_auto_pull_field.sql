-- Public API launch simplification (2026-07-19): pull rules are withdrawn from
-- the public surface (customers keep in sync by re-running their filtered
-- unlock on their own schedule; dedupe makes that "new contacts only" by
-- nature). The status payload therefore drops auto_pull_enabled. The rule
-- engine (api_run_pull_rules and friends) stays dormant in the database for a
-- possible future opt-in bulk-pull feature.

CREATE OR REPLACE FUNCTION public.api_get_event_unlock_status(p_user_id uuid, p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_total integer;
  v_with_email integer;
  v_unlocked integer := 0;
  v_emails_unlocked integer := 0;
  v_balance integer := 0;
BEGIN
  -- Same live counting path as facets and unlock (valid-email definition, no settle filter).
  SELECT count(*), count(*) FILTER (WHERE f.has_email)
  INTO v_total, v_with_email
  FROM public.event_filtered_contact_ids(p_event_id, '{}'::jsonb) f;

  IF p_user_id IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE email_unlocked)
    INTO v_unlocked, v_emails_unlocked
    FROM customer_contact_access
    WHERE user_id = p_user_id AND event_id = p_event_id;

    v_balance := api_get_user_credits(p_user_id);
  END IF;

  RETURN json_build_object(
    'total_contacts', v_total,
    'contacts_with_email', v_with_email,
    'unlocked_count', v_unlocked,
    'emails_unlocked', v_emails_unlocked,
    'remaining_count', v_total - v_unlocked,
    'user_balance', v_balance
  );
END;
$function$;
