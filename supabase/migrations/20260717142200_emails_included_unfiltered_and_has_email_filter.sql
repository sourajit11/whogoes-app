-- Emails included on ANY unfiltered unlock + new "has_email" filter (Souraa, 2026-07-17).
--
-- Two pricing paths, restated:
--   No ICP filter  -> 1 credit per contact, verified emails INCLUDED free. This now
--     covers PARTIAL unfiltered unlocks too, not only "take the whole list". Previously
--     (20260712130800) emails were only included when the unlock left nothing locked.
--   ICP filter     -> 1 credit per identity, +1 credit per revealed email (unchanged).
--
-- has_email is NOT an ICP filter: it just restricts the pool to contacts that have a
-- verified email. Applied on its own it prices like an unfiltered unlock (emails
-- included). Combined with a real ICP filter it's a normal filtered unlock.

-- 1) Filter helper gains a has_email predicate. Callers (facets, filtered preview, unlock
--    candidate selection, reveal scope) all go through this one function, so the filter
--    propagates everywhere. Based on the live def in 20260712110902.
CREATE OR REPLACE FUNCTION public.event_filtered_contact_ids(p_event_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(contact_id uuid, has_email boolean, created_at timestamp with time zone, seniority text, func text, industry text, sizeb text, country text, role text, company_name text, is_speaker boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '45s'
AS $function$
  select contact_id, has_email, created_at, seniority, func, industry, sizeb, country, role, company_name, is_speaker
  from (
    select distinct on (ce.contact_id)
      ce.contact_id,
      exists (
        select 1 from contact_emails em
        where em.contact_id = ce.contact_id
          and em.status = 'valid'
          and em.email is not null and em.email <> ''
      ) as has_email,
      ce.created_at,
      c.seniority_bucket as seniority, c.function_bucket as func, co.industry_bucket as industry,
      co.size_bucket as sizeb, c.country as country,
      case
        when coalesce(cer.role,'attendee') in ('organizer','sponsor','exhibitor') then cer.role
        when coalesce(ce.is_speaker,false) or ce.source_type in ('post_author','mentioned') then 'attendee'
        else 'expected_attendee'
      end as role,
      co.name as company_name, coalesce(ce.is_speaker,false) as is_speaker
    from contact_events ce
    join contacts c on c.id = ce.contact_id
    left join companies co on co.id = c.current_company_id
    left join company_event_roles cer on cer.event_id = p_event_id and cer.company_id = c.current_company_id
    where ce.event_id = p_event_id
      and (not (p_filters ? 'seniority') or c.seniority_bucket = any(array(select jsonb_array_elements_text(p_filters->'seniority')))
           or ((c.seniority_bucket is null or c.seniority_bucket = 'Other') and ((p_filters->'seniority') ? 'Unknown' or (p_filters->'seniority') ? 'Other / Unknown')))
      and (not (p_filters ? 'function')  or c.function_bucket  = any(array(select jsonb_array_elements_text(p_filters->'function')))
           or (c.function_bucket is null and (p_filters->'function') ? 'Unknown'))
      and (not (p_filters ? 'industry')  or co.industry_bucket = any(array(select jsonb_array_elements_text(p_filters->'industry')))
           or (co.industry_bucket is null and ((p_filters->'industry') ? 'Unknown' or (p_filters->'industry') ? 'Other / Unknown')))
      and (not (p_filters ? 'size')      or co.size_bucket     = any(array(select jsonb_array_elements_text(p_filters->'size')))
           or (co.size_bucket is null and (p_filters->'size') ? 'Unknown'))
      and (not (p_filters ? 'country')   or c.country          = any(array(select jsonb_array_elements_text(p_filters->'country')))
           or (c.country is null and (p_filters->'country') ? 'Unknown'))
      and (not (p_filters ? 'speaker')   or (p_filters->>'speaker')::boolean is not true or coalesce(ce.is_speaker,false) = true)
      and (not (p_filters ? 'title_keyword') or p_filters->>'title_keyword' = ''
           or c.current_title ilike '%'||(p_filters->>'title_keyword')||'%'
           or c.headline ilike '%'||(p_filters->>'title_keyword')||'%')
      and (not (p_filters ? 'company_include') or p_filters->>'company_include' = ''
           or co.name ilike '%'||(p_filters->>'company_include')||'%')
      and (not (p_filters ? 'company_exclude') or p_filters->>'company_exclude' = ''
           or co.name is null or co.name not ilike '%'||(p_filters->>'company_exclude')||'%')
    order by ce.contact_id, coalesce(ce.is_speaker,false) desc, (ce.source_type in ('post_author','mentioned')) desc, ce.created_at desc nulls last
  ) sub
  where (not (p_filters ? 'role') or sub.role = any(array(select jsonb_array_elements_text(p_filters->'role'))))
    and (not (p_filters ? 'has_email') or (p_filters->>'has_email')::boolean is not true or sub.has_email);
$function$;

grant execute on function public.event_filtered_contact_ids(uuid, jsonb) to anon, authenticated, service_role;

-- 2) Unlock RPC: verified emails included on any unlock with no ICP filter (partial or
--    whole), applied to every row of the batch. Based on the live def in 20260712130800.
CREATE OR REPLACE FUNCTION public.unlock_event_contacts(p_event_id uuid, p_count integer, p_filters jsonb DEFAULT '{}'::jsonb, p_batch_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_user_id UUID;
  v_free INTEGER;
  v_paid INTEGER;
  v_total_balance INTEGER;
  v_actual_count INTEGER;
  v_actual_inserted INTEGER;
  v_deduct_free INTEGER;
  v_deduct_paid INTEGER;
  v_new_balance INTEGER;
  v_batch_id UUID;
  v_created_batch BOOLEAN := false;
  v_no_icp BOOLEAN;
  v_emails_included INTEGER := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;
  IF p_count <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'Invalid count');
  END IF;

  SELECT free_credits INTO v_free FROM user_signups WHERE user_id = v_user_id;
  IF v_free IS NULL THEN
    INSERT INTO user_signups (user_id, free_credits) VALUES (v_user_id, 20)
    ON CONFLICT (user_id) DO NOTHING;
    v_free := 20;
  END IF;

  SELECT credits_balance INTO v_paid FROM customers WHERE user_id = v_user_id;
  v_paid := COALESCE(v_paid, 0);
  v_total_balance := v_free + v_paid;

  IF v_total_balance <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'No credits remaining', 'current_balance', 0);
  END IF;

  v_actual_count := LEAST(p_count, v_total_balance);

  INSERT INTO customer_event_subscriptions (user_id, event_id)
  VALUES (v_user_id, p_event_id)
  ON CONFLICT (user_id, event_id) DO NOTHING;

  -- Continue the caller's batch only if it really is theirs, for this event;
  -- otherwise start a fresh one.
  IF p_batch_id IS NOT NULL THEN
    SELECT id INTO v_batch_id FROM unlock_batches
    WHERE id = p_batch_id AND user_id = v_user_id AND event_id = p_event_id;
  END IF;
  IF v_batch_id IS NULL THEN
    INSERT INTO unlock_batches (user_id, event_id, filters, requested_count)
    VALUES (v_user_id, p_event_id, COALESCE(p_filters, '{}'::jsonb), p_count)
    RETURNING id INTO v_batch_id;
    v_created_batch := true;
  END IF;

  -- Candidate-first selection from the shared filter helper (email-verified first,
  -- then most recent). p_filters = {} returns the whole event (legacy behavior).
  INSERT INTO customer_contact_access (user_id, contact_id, event_id, batch_id)
  SELECT v_user_id, f.contact_id, p_event_id, v_batch_id
  FROM public.event_filtered_contact_ids(p_event_id, p_filters) f
  WHERE NOT EXISTS (
    SELECT 1 FROM customer_contact_access cca
    WHERE cca.user_id = v_user_id AND cca.contact_id = f.contact_id AND cca.event_id = p_event_id
  )
  ORDER BY (CASE WHEN f.has_email THEN 0 ELSE 1 END), f.created_at DESC NULLS LAST
  LIMIT v_actual_count
  ON CONFLICT (user_id, contact_id, event_id) DO NOTHING;

  GET DIAGNOSTICS v_actual_inserted = ROW_COUNT;
  IF v_actual_inserted = 0 THEN
    -- Don't leave an empty batch behind when nothing was delivered.
    IF v_created_batch THEN
      DELETE FROM unlock_batches WHERE id = v_batch_id;
    END IF;
    RETURN json_build_object('success', false, 'message', 'No more contacts to unlock');
  END IF;

  UPDATE unlock_batches
  SET unlocked_count = unlocked_count + v_actual_inserted
  WHERE id = v_batch_id;

  -- Emails included free on any unlock with no ICP filter. has_email on its own is not
  -- an ICP filter (the user is filtering FOR emails), so strip it before the test. This
  -- covers partial unfiltered unlocks; the flag is applied to every row of this batch.
  -- email_charged_at stays NULL for included emails (they were not individually charged).
  v_no_icp := (p_filters IS NULL OR (p_filters - 'has_email') = '{}'::jsonb);
  IF v_no_icp THEN
    UPDATE customer_contact_access cca
    SET email_unlocked = true
    WHERE cca.user_id = v_user_id AND cca.event_id = p_event_id
      AND cca.batch_id = v_batch_id AND cca.email_unlocked = false;
    GET DIAGNOSTICS v_emails_included = ROW_COUNT;
  END IF;

  v_deduct_free := LEAST(v_actual_inserted, v_free);
  v_deduct_paid := v_actual_inserted - v_deduct_free;

  IF v_deduct_free > 0 THEN
    UPDATE user_signups SET free_credits = free_credits - v_deduct_free, updated_at = now() WHERE user_id = v_user_id;
  END IF;
  IF v_deduct_paid > 0 THEN
    UPDATE customers SET credits_balance = credits_balance - v_deduct_paid, updated_at = now() WHERE user_id = v_user_id;
  END IF;

  SELECT COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0)
  INTO v_new_balance
  FROM user_signups us LEFT JOIN customers c ON c.user_id = us.user_id
  WHERE us.user_id = v_user_id;

  RETURN json_build_object(
    'success', true,
    'message', v_actual_inserted || ' contacts unlocked',
    'credits_spent', v_actual_inserted,
    'new_balance', v_new_balance,
    'contacts_unlocked', v_actual_inserted,
    'batch_id', v_batch_id,
    'full_list', v_no_icp,
    'emails_included', v_emails_included
  );
END;
$function$;

grant execute on function public.unlock_event_contacts(uuid, integer, jsonb, uuid) to authenticated;
