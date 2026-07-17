-- Phase 5: pre-unlock ICP filtering RPCs. A shared candidate-filter helper drives the facets,
-- the unlock, and the My Events display so all three apply identical predicates. Filters arrive as
-- one jsonb param (extensible, keeps signatures stable). Empty/absent key = no constraint on that axis.

-- Shared helper: matching contacts in an event's candidate pool, one row per contact.
create or replace function public.event_filtered_contact_ids(p_event_id uuid, p_filters jsonb default '{}'::jsonb)
returns table(
  contact_id uuid, has_email boolean, created_at timestamptz,
  seniority text, func text, industry text, sizeb text, country text,
  role text, company_name text, is_speaker boolean
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '45s'
as $$
  select distinct on (ce.contact_id)
    ce.contact_id,
    exists(select 1 from contact_emails em
           where em.contact_id = ce.contact_id and em.is_primary = true
             and em.email is not null and em.email <> '') as has_email,
    ce.created_at,
    c.seniority_bucket, c.function_bucket, co.industry_bucket, co.size_bucket, c.country,
    coalesce(cer.role, 'attendee') as role, co.name, coalesce(ce.is_speaker, false)
  from contact_events ce
  join contacts c on c.id = ce.contact_id
  left join companies co on co.id = c.current_company_id
  left join company_event_roles cer on cer.event_id = p_event_id and cer.company_id = c.current_company_id
  where ce.event_id = p_event_id
    and (not (p_filters ? 'seniority') or c.seniority_bucket = any(array(select jsonb_array_elements_text(p_filters->'seniority'))))
    and (not (p_filters ? 'function')  or c.function_bucket  = any(array(select jsonb_array_elements_text(p_filters->'function'))))
    and (not (p_filters ? 'industry')  or co.industry_bucket = any(array(select jsonb_array_elements_text(p_filters->'industry'))))
    and (not (p_filters ? 'size')      or co.size_bucket     = any(array(select jsonb_array_elements_text(p_filters->'size'))))
    and (not (p_filters ? 'country')   or c.country          = any(array(select jsonb_array_elements_text(p_filters->'country'))))
    and (not (p_filters ? 'role')      or coalesce(cer.role,'attendee') = any(array(select jsonb_array_elements_text(p_filters->'role'))))
    and (not (p_filters ? 'speaker')   or (p_filters->>'speaker')::boolean is not true or coalesce(ce.is_speaker,false) = true)
    and (not (p_filters ? 'title_keyword') or p_filters->>'title_keyword' = ''
         or c.current_title ilike '%'||(p_filters->>'title_keyword')||'%'
         or c.headline ilike '%'||(p_filters->>'title_keyword')||'%')
    and (not (p_filters ? 'company_include') or p_filters->>'company_include' = ''
         or co.name ilike '%'||(p_filters->>'company_include')||'%')
    and (not (p_filters ? 'company_exclude') or p_filters->>'company_exclude' = ''
         or co.name is null or co.name not ilike '%'||(p_filters->>'company_exclude')||'%')
  order by ce.contact_id, coalesce(ce.is_speaker,false) desc, ce.created_at desc nulls last;
$$;

-- Facets: matched/with-email counts + breakdowns for the live filter summary.
create or replace function public.get_event_filter_facets(p_event_id uuid, p_filters jsonb default '{}'::jsonb)
returns json
language sql
stable
security definer
set search_path = public
set statement_timeout = '60s'
as $$
  with m as (select * from public.event_filtered_contact_ids(p_event_id, p_filters))
  select json_build_object(
    'matched',    (select count(*) from m),
    'with_email', (select count(*) from m where has_email),
    'by_seniority', (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select coalesce(seniority,'Unknown') k, count(*) n from m group by 1) s),
    'by_function',  (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select coalesce(func,'Unknown') k, count(*) n from m group by 1) s),
    'by_role',      (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select role k, count(*) n from m group by 1) s),
    'by_country',   (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select coalesce(country,'Unknown') k, count(*) n from m group by 1 order by 2 desc limit 15) s),
    'top_companies',(select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select company_name k, count(*) n from m where company_name is not null group by 1 order by 2 desc limit 15) s)
  );
$$;

-- Unlock matched contacts only (filters default to {} = unlock all, preserving old behavior).
drop function if exists public.unlock_event_contacts(uuid, integer);
create or replace function public.unlock_event_contacts(p_event_id uuid, p_count integer, p_filters jsonb default '{}'::jsonb)
returns json
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $function$
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

  -- Candidate-first selection now comes from the shared filter helper (email-verified first,
  -- then most recent). p_filters = {} returns the whole event (legacy behavior).
  INSERT INTO customer_contact_access (user_id, contact_id, event_id)
  SELECT v_user_id, f.contact_id, p_event_id
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
    RETURN json_build_object('success', false, 'message', 'No more contacts to unlock');
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
    'contacts_unlocked', v_actual_inserted
  );
END;
$function$;

grant execute on function public.event_filtered_contact_ids(uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.get_event_filter_facets(uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.unlock_event_contacts(uuid, integer, jsonb) to authenticated, service_role;
