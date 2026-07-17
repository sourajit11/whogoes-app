-- UX fix: collapse the two industry catch-alls into one.
--
-- Company industry has two "we don't know" states that customers can't tell apart:
--   * industry_bucket = 'Other / Unknown'  — a raw industry string exists but the
--     bucket map hasn't been taught it (fixable by /audit-company-industries)
--   * industry_bucket IS NULL              — no raw industry at all (enrichment gap)
-- The facet builder labelled NULL as 'Unknown' (coalesce) and left 'Other / Unknown'
-- as its own key, so the Industry filter showed BOTH "Other / Unknown" and "Unknown"
-- as separate selectable chips with separate counts. That distinction is meaningless
-- to a customer. This merges them into a single 'Other / Unknown' chip.
--
-- Three coordinated changes (industry axis only; seniority/function/size/country keep
-- their existing 'Unknown' catch-all):
--   1. get_event_filter_facets   — by_industry maps NULL + 'Other / Unknown' -> one key
--   2. event_filtered_contact_ids / event_filtered_facts — selecting 'Other / Unknown'
--      now also matches NULL rows (the old 'Unknown' branch is kept for back-compat)
--   3. get_event_filter_preview  — the SAMPLE row now shows the industry BUCKET (what
--      the filter runs on) instead of the raw company.industry string, so a row filtered
--      as "Other / Unknown" stops displaying a real-looking industry like
--      "Satellite Telecommunications" and contradicting the filter.

-- 1. Facet builder: merge NULL and 'Other / Unknown' into a single industry key.
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
    'by_industry',  (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select case when industry is null or industry = 'Other / Unknown' then 'Other / Unknown' else industry end k,
                                  count(*) n from m group by 1 order by 2 desc limit 30) s),
    'by_size',      (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select coalesce(sizeb,'Unknown') k, count(*) n from m group by 1) s),
    'by_country',   (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select coalesce(country,'Unknown') k, count(*) n from m group by 1 order by 2 desc limit 15) s),
    'top_companies',(select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select company_name k, count(*) n from m where company_name is not null group by 1 order by 2 desc limit 15) s)
  );
$$;

-- 2a. Canonical filter helper: selecting 'Other / Unknown' also matches NULL industry.
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
      c.has_primary_email as has_email,
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
           or (c.seniority_bucket is null and (p_filters->'seniority') ? 'Unknown'))
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
  where (not (p_filters ? 'role') or sub.role = any(array(select jsonb_array_elements_text(p_filters->'role'))));
$function$;

grant execute on function public.event_filtered_contact_ids(uuid, jsonb) to anon, authenticated, service_role;

-- 2b. Denormalized sibling (unlocked My Events view): same 'Other / Unknown' -> NULL match.
CREATE OR REPLACE FUNCTION public.event_filtered_facts(p_event_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(contact_id uuid, has_email boolean, created_at timestamp with time zone, seniority text, func text, industry text, sizeb text, country text, role text, company_name text, is_speaker boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
  SELECT f.contact_id, f.has_email, f.created_at, f.seniority, f.func, f.industry, f.sizeb, f.country, f.role, f.company_name, f.is_speaker
  FROM public.event_contact_facts f
  WHERE f.event_id = p_event_id
    AND (not (p_filters ? 'seniority') or f.seniority = any(array(select jsonb_array_elements_text(p_filters->'seniority')))
         or (f.seniority is null and (p_filters->'seniority') ? 'Unknown'))
    AND (not (p_filters ? 'function')  or f.func      = any(array(select jsonb_array_elements_text(p_filters->'function')))
         or (f.func is null and (p_filters->'function') ? 'Unknown'))
    AND (not (p_filters ? 'industry')  or f.industry  = any(array(select jsonb_array_elements_text(p_filters->'industry')))
         or (f.industry is null and ((p_filters->'industry') ? 'Unknown' or (p_filters->'industry') ? 'Other / Unknown')))
    AND (not (p_filters ? 'size')      or f.sizeb     = any(array(select jsonb_array_elements_text(p_filters->'size')))
         or (f.sizeb is null and (p_filters->'size') ? 'Unknown'))
    AND (not (p_filters ? 'country')   or f.country   = any(array(select jsonb_array_elements_text(p_filters->'country')))
         or (f.country is null and (p_filters->'country') ? 'Unknown'))
    AND (not (p_filters ? 'role')      or f.role      = any(array(select jsonb_array_elements_text(p_filters->'role'))))
    AND (not (p_filters ? 'speaker')   or (p_filters->>'speaker')::boolean is not true or f.is_speaker = true)
    AND (not (p_filters ? 'title_keyword') or p_filters->>'title_keyword' = ''
         or f.title_search ilike '%'||(p_filters->>'title_keyword')||'%')
    AND (not (p_filters ? 'company_include') or p_filters->>'company_include' = ''
         or f.company_name ilike '%'||(p_filters->>'company_include')||'%')
    AND (not (p_filters ? 'company_exclude') or p_filters->>'company_exclude' = ''
         or f.company_name is null or f.company_name not ilike '%'||(p_filters->>'company_exclude')||'%');
$function$;

-- 3. Preview: SAMPLE row shows the industry BUCKET (merged), matching the filter/breakdown.
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
        'company_industry', coalesce(co.industry_bucket, 'Other / Unknown'),
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
        'current_title', c.current_title,
        'seniority', x.seniority, 'function', x.func, 'industry', coalesce(x.industry, 'Other / Unknown'), 'size', x.sizeb,
        'country', x.country, 'role', x.role, 'is_speaker', x.is_speaker, 'has_email', x.has_email
      ) order by x.has_email desc), '[]'::json)
      from (select * from ranked where rn between 2 and p_limit + 1) x
      left join contacts c on c.id = x.contact_id
    )
  );
$$;

grant execute on function public.get_event_filter_preview(uuid, jsonb, integer) to anon, authenticated, service_role;
