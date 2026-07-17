-- Pre-unlock filtered preview: proves relevance without leaking the asset. Returns the matched
-- count, ONE fully-named sample row (identity + post, but NOT the raw email), and up to p_limit
-- redacted rows exposing only ICP attributes (no name/company/email). The client blurs identity.
create or replace function public.get_event_filter_preview(
  p_event_id uuid,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 10
)
returns json
language sql
stable
security definer
set search_path = public
set statement_timeout = '45s'
as $$
  with m as (select * from public.event_filtered_contact_ids(p_event_id, p_filters)),
  ranked as (
    select *, row_number() over (order by has_email desc, created_at desc nulls last) as rn
    from m
  ),
  s as (select contact_id from ranked where rn = 1)
  select json_build_object(
    'matched', (select count(*) from m),
    'with_email', (select count(*) from m where has_email),
    'sample', (
      select case when s.contact_id is null then null else json_build_object(
        'full_name', c.full_name,
        'current_title', c.current_title,
        'company_name', co.name,
        'company_industry', co.industry,
        'company_size', co.size_range,
        'country', c.country,
        'seniority', c.seniority_bucket,
        'function', c.function_bucket,
        'role', coalesce(cer.role, 'attendee'),
        'is_speaker', coalesce((select bool_or(ce.is_speaker) from contact_events ce
                                where ce.contact_id = c.id and ce.event_id = p_event_id), false),
        'has_email', exists(select 1 from contact_emails e where e.contact_id = c.id and e.status = 'valid'
                            and e.email is not null and e.email <> ''),
        'contact_linkedin_url', c.linkedin_url,
        'post_url', (select p.post_url from contact_events ce join posts p on p.id = ce.post_id
                     where ce.contact_id = c.id and ce.event_id = p_event_id and p.post_url is not null limit 1)
      ) end
      from s
      left join contacts c on c.id = s.contact_id
      left join companies co on co.id = c.current_company_id
      left join company_event_roles cer on cer.event_id = p_event_id and cer.company_id = c.current_company_id
    ),
    'rows', (
      select coalesce(json_agg(json_build_object(
        'seniority', seniority, 'function', func, 'industry', industry, 'size', sizeb,
        'country', country, 'role', role, 'is_speaker', is_speaker, 'has_email', has_email
      ) order by has_email desc), '[]'::json)
      from (select * from ranked where rn between 2 and p_limit + 1) x
    )
  );
$$;

grant execute on function public.get_event_filter_preview(uuid, jsonb, integer) to anon, authenticated, service_role;
