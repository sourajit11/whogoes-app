-- Two-tier unlock: identity (the existing 1-credit unlock) then email (+1 credit, opt-in).
-- email_unlocked gates the email; everything unlocked before this change is grandfathered true
-- (it was paid under the old model where 1 credit included the email).
alter table customer_contact_access
  add column if not exists email_unlocked boolean not null default false,
  add column if not exists email_charged_at timestamptz;

update customer_contact_access set email_unlocked = true where email_unlocked = false;

-- Reveal verified emails for contacts the user has already identity-unlocked in this event.
-- Charges 1 credit per contact, ONLY for contacts that have a valid email and are not yet
-- revealed. Optionally narrow by explicit contact ids and/or the same jsonb ICP filters.
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

  update customer_contact_access cca
  set email_unlocked = true, email_charged_at = now()
  where cca.user_id = v_user and cca.event_id = p_event_id
    and cca.contact_id in (select contact_id from _to_reveal limit v_target);
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

  return json_build_object('success', true, 'emails_revealed', v_revealed,
    'credits_spent', v_revealed, 'new_balance', v_newbal);
end;
$$;

-- Email-gated My Events display: email only when email_unlocked; adds has_email + email_unlocked.
drop function if exists public.get_subscribed_event_contacts(uuid, text, integer, integer, jsonb);
create or replace function public.get_subscribed_event_contacts(
  p_event_id uuid,
  p_filter text default 'all',
  p_limit integer default null,
  p_offset integer default 0,
  p_filters jsonb default '{}'::jsonb
)
returns table(contact_id uuid, full_name text, first_name text, last_name text, current_title text, headline text, contact_linkedin_url text, city text, country text, email text, email_status text, email_provider text, has_email boolean, email_unlocked boolean, company_name text, company_linkedin_url text, company_domain text, company_website text, company_industry text, company_size text, company_headquarters text, company_founded_year integer, company_description text, post_url text, post_content text, post_date timestamp with time zone, source text, first_line_personalization text, is_downloaded boolean, downloaded_at timestamp with time zone)
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '60s'
as $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM customer_event_subscriptions
    WHERE user_id = auth.uid() AND event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Not subscribed to this event';
  END IF;

  RETURN QUERY
  WITH page AS (
    SELECT cca.contact_id, cca.charged_at, cca.is_downloaded, cca.downloaded_at, cca.email_unlocked
    FROM customer_contact_access cca
    JOIN contacts c ON c.id = cca.contact_id
    LEFT JOIN companies co ON co.id = c.current_company_id
    LEFT JOIN company_event_roles cer ON cer.event_id = p_event_id AND cer.company_id = c.current_company_id
    WHERE cca.event_id = p_event_id
      AND cca.user_id = auth.uid()
      AND (
        p_filter = 'all'
        OR (p_filter = 'new' AND cca.is_downloaded = false)
        OR (p_filter = 'processed' AND cca.is_downloaded = true)
      )
      AND (not (p_filters ? 'seniority') or c.seniority_bucket = any(array(select jsonb_array_elements_text(p_filters->'seniority'))))
      AND (not (p_filters ? 'function')  or c.function_bucket  = any(array(select jsonb_array_elements_text(p_filters->'function'))))
      AND (not (p_filters ? 'industry')  or co.industry_bucket = any(array(select jsonb_array_elements_text(p_filters->'industry'))))
      AND (not (p_filters ? 'size')      or co.size_bucket     = any(array(select jsonb_array_elements_text(p_filters->'size'))))
      AND (not (p_filters ? 'country')   or c.country          = any(array(select jsonb_array_elements_text(p_filters->'country'))))
      AND (not (p_filters ? 'role')      or coalesce(cer.role,'attendee') = any(array(select jsonb_array_elements_text(p_filters->'role'))))
      AND (not (p_filters ? 'speaker')   or (p_filters->>'speaker')::boolean is not true
           or exists(select 1 from contact_events ce2 where ce2.contact_id = cca.contact_id and ce2.event_id = p_event_id and ce2.is_speaker = true))
      AND (not (p_filters ? 'title_keyword') or p_filters->>'title_keyword' = ''
           or c.current_title ilike '%'||(p_filters->>'title_keyword')||'%'
           or c.headline ilike '%'||(p_filters->>'title_keyword')||'%')
      AND (not (p_filters ? 'company_include') or p_filters->>'company_include' = ''
           or co.name ilike '%'||(p_filters->>'company_include')||'%')
      AND (not (p_filters ? 'company_exclude') or p_filters->>'company_exclude' = ''
           or co.name is null or co.name not ilike '%'||(p_filters->>'company_exclude')||'%')
    ORDER BY cca.charged_at DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    c.id AS contact_id, c.full_name, c.first_name, c.last_name, c.current_title, c.headline,
    c.linkedin_url AS contact_linkedin_url, c.city, c.country,
    CASE WHEN page.email_unlocked THEN cem.email ELSE NULL END AS email,
    CASE WHEN page.email_unlocked THEN cem.status ELSE NULL END AS email_status,
    CASE WHEN page.email_unlocked THEN cem.provider ELSE NULL END AS email_provider,
    (cem.email IS NOT NULL) AS has_email,
    page.email_unlocked,
    co.name AS company_name, co.linkedin_url AS company_linkedin_url, co.domain AS company_domain,
    co.website AS company_website, co.industry AS company_industry, co.size_range AS company_size,
    co.headquarters AS company_headquarters, co.founded_year AS company_founded_year, co.description AS company_description,
    p.post_url, p.content AS post_content, p.posted_at AS post_date,
    ce.source_type AS source, ce.first_line_personalization,
    page.is_downloaded, page.downloaded_at
  FROM page
  JOIN contacts c ON c.id = page.contact_id
  JOIN contact_events ce ON ce.contact_id = c.id AND ce.event_id = p_event_id
  LEFT JOIN LATERAL (
    SELECT e.email, e.status, e.provider
    FROM contact_emails e
    WHERE e.contact_id = c.id AND e.status = 'valid'
    ORDER BY e.is_primary DESC NULLS LAST
    LIMIT 1
  ) cem ON true
  LEFT JOIN companies co ON c.current_company_id = co.id
  LEFT JOIN posts p ON ce.post_id = p.id
  ORDER BY page.charged_at DESC;
END;
$function$;

grant execute on function public.reveal_event_emails(uuid, uuid[], jsonb) to authenticated, service_role;
grant execute on function public.get_subscribed_event_contacts(uuid, text, integer, integer, jsonb) to authenticated, service_role;
