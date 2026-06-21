-- Split "attendee" into Confirmed vs Expected at the per-contact level.
-- Expected attendee = the contact's only evidence for this event is a bare repost or a
-- mention (no first-person post, not a speaker) and the company has no higher role.
-- Confirmed attendee = first-person post (source_type='post_author') or speaker.
-- Sponsor/Exhibitor/Organizer (company-level) always win. Computed from source_type,
-- no backfill. Propagates to facets / preview / role filter / filtered unlock since they
-- all consume this helper.
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
      exists(select 1 from contact_emails em
             where em.contact_id = ce.contact_id and em.is_primary = true
               and em.email is not null and em.email <> '') as has_email,
      ce.created_at,
      c.seniority_bucket as seniority, c.function_bucket as func, co.industry_bucket as industry,
      co.size_bucket as sizeb, c.country as country,
      -- effective per-contact role; distinct-on ordering below ensures the picked row is
      -- the speaker row if any, else a post_author row if any, so source_type/is_speaker
      -- here reflect the contact's strongest attendance evidence.
      case
        when coalesce(cer.role,'attendee') in ('organizer','sponsor','exhibitor') then cer.role
        when coalesce(ce.is_speaker,false) or ce.source_type = 'post_author' then 'attendee'
        else 'expected_attendee'
      end as role,
      co.name as company_name, coalesce(ce.is_speaker,false) as is_speaker
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
      and (not (p_filters ? 'speaker')   or (p_filters->>'speaker')::boolean is not true or coalesce(ce.is_speaker,false) = true)
      and (not (p_filters ? 'title_keyword') or p_filters->>'title_keyword' = ''
           or c.current_title ilike '%'||(p_filters->>'title_keyword')||'%'
           or c.headline ilike '%'||(p_filters->>'title_keyword')||'%')
      and (not (p_filters ? 'company_include') or p_filters->>'company_include' = ''
           or co.name ilike '%'||(p_filters->>'company_include')||'%')
      and (not (p_filters ? 'company_exclude') or p_filters->>'company_exclude' = ''
           or co.name is null or co.name not ilike '%'||(p_filters->>'company_exclude')||'%')
    order by ce.contact_id, coalesce(ce.is_speaker,false) desc, (ce.source_type = 'post_author') desc, ce.created_at desc nulls last
  ) sub
  where (not (p_filters ? 'role') or sub.role = any(array(select jsonb_array_elements_text(p_filters->'role'))));
$function$;
