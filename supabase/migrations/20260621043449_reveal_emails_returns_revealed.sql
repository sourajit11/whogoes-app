-- reveal_event_emails now returns the revealed {contact_id, email} pairs so the client can patch
-- its table in place instead of refetching the whole event after each reveal.
create or replace function public.reveal_event_emails(
  p_event_id uuid,
  p_contact_ids uuid[] default null,
  p_filters jsonb default '{}'::jsonb
)
returns json
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
declare
  v_user uuid;
  v_free int;
  v_paid int;
  v_bal int;
  v_target int;
  v_revealed int;
  v_df int;
  v_dp int;
  v_newbal int;
begin
  v_user := auth.uid();
  if v_user is null then
    return json_build_object('success', false, 'message', 'Not authenticated');
  end if;

  select coalesce(free_credits,0) into v_free from user_signups where user_id = v_user;
  v_free := coalesce(v_free, 0);
  select coalesce(credits_balance,0) into v_paid from customers where user_id = v_user;
  v_paid := coalesce(v_paid, 0);
  v_bal := v_free + v_paid;

  create temporary table _to_reveal on commit drop as
  select cca.contact_id
  from customer_contact_access cca
  where cca.user_id = v_user
    and cca.event_id = p_event_id
    and cca.email_unlocked = false
    and (p_contact_ids is null or cca.contact_id = any(p_contact_ids))
    and exists (select 1 from contact_emails em
                where em.contact_id = cca.contact_id and em.status = 'valid'
                  and em.email is not null and em.email <> '')
    and (p_filters = '{}'::jsonb
         or cca.contact_id in (select f.contact_id from public.event_filtered_contact_ids(p_event_id, p_filters) f));

  select count(*) into v_target from _to_reveal;
  if v_target = 0 then
    return json_build_object('success', false, 'message', 'No emails to reveal');
  end if;
  if v_bal <= 0 then
    return json_build_object('success', false, 'message', 'No credits remaining');
  end if;

  v_target := least(v_target, v_bal);

  create temporary table _rev on commit drop as
  select contact_id from _to_reveal limit v_target;

  update customer_contact_access cca
  set email_unlocked = true, email_charged_at = now()
  where cca.user_id = v_user and cca.event_id = p_event_id
    and cca.contact_id in (select contact_id from _rev);
  get diagnostics v_revealed = row_count;

  v_df := least(v_revealed, v_free);
  v_dp := v_revealed - v_df;
  if v_df > 0 then
    update user_signups set free_credits = free_credits - v_df, updated_at = now() where user_id = v_user;
  end if;
  if v_dp > 0 then
    update customers set credits_balance = credits_balance - v_dp, updated_at = now() where user_id = v_user;
  end if;

  select coalesce(us.free_credits,0) + coalesce(c.credits_balance,0) into v_newbal
  from user_signups us left join customers c on c.user_id = us.user_id
  where us.user_id = v_user;

  return json_build_object(
    'success', true,
    'emails_revealed', v_revealed,
    'credits_spent', v_revealed,
    'new_balance', v_newbal,
    'revealed', (
      select coalesce(json_agg(json_build_object(
        'contact_id', r.contact_id,
        'email', (select e.email from contact_emails e
                  where e.contact_id = r.contact_id and e.status = 'valid'
                  order by e.is_primary desc nulls last limit 1)
      )), '[]'::json)
      from _rev r
    )
  );
end;
$$;
