-- get_event_unlock_status (signed-in event-detail header) counted contacts
-- differently than get_event_by_slug (the public /events/[slug] page), so a
-- logged-in user saw FEWER contacts than a signed-out visitor on the same
-- event. Two divergences, both triggered while an event is actively scraping:
--
--   1. Settle filter: get_event_unlock_status excluded any contact updated in
--      the last 3 hours (anti-join), while get_event_by_slug counts all
--      contact_events. During active collection this dropped the total from
--      576 -> 255 on Gamescom 2026 (321 contacts touched <3h ago).
--   2. Email definition: get_event_unlock_status counted is_primary=true,
--      get_event_by_slug counts status='valid'. Because every email-bearing
--      contact happened to be in the fresh <3h batch, the settle filter on top
--      of (1) made "with email" read 0 even though 322 valid emails exist.
--
-- Fix: count exactly like get_event_by_slug so both views always agree —
--   total_contacts  = ALL contact_events for the event (COUNT(*) == DISTINCT
--                     contact via uq_contact_event), no settle filter.
--   contacts_with_email = DISTINCT contacts with a status='valid' email.
-- The user-specific fields (unlocked/balance/is_subscribed) are unchanged.
-- Reversible: re-apply the prior body from 20260602120000.

CREATE OR REPLACE FUNCTION public.get_event_unlock_status(p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_total INTEGER;
  v_with_email INTEGER;
  v_unlocked INTEGER := 0;
  v_balance INTEGER := 0;
  v_is_subscribed BOOLEAN := false;
BEGIN
  v_user_id := auth.uid();

  -- Total contacts: all contact_events for the event. COUNT(*) == DISTINCT
  -- contact_id thanks to uq_contact_event. Matches get_event_by_slug exactly.
  SELECT COUNT(*) INTO v_total
  FROM contact_events ce
  WHERE ce.event_id = p_event_id;

  -- With email: distinct contacts that have a status='valid' email. Same
  -- definition as get_event_by_slug.
  SELECT COUNT(*) INTO v_with_email
  FROM (
    SELECT DISTINCT ce.contact_id
    FROM contact_events ce
    JOIN contact_emails em ON em.contact_id = ce.contact_id
    WHERE ce.event_id = p_event_id
      AND em.status = 'valid'
  ) sub;

  IF v_user_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_unlocked
    FROM customer_contact_access
    WHERE user_id = v_user_id AND event_id = p_event_id;

    SELECT COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0)
    INTO v_balance
    FROM user_signups us
    LEFT JOIN customers c ON c.user_id = us.user_id
    WHERE us.user_id = v_user_id;

    v_balance := COALESCE(v_balance, 0);

    SELECT EXISTS(
      SELECT 1 FROM customer_event_subscriptions
      WHERE user_id = v_user_id AND event_id = p_event_id
    ) INTO v_is_subscribed;
  END IF;

  RETURN json_build_object(
    'total_contacts', v_total,
    'unlocked_count', v_unlocked,
    'remaining_count', v_total - v_unlocked,
    'contacts_with_email', v_with_email,
    'user_balance', v_balance,
    'is_subscribed', v_is_subscribed
  );
END;
$function$;
