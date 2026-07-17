-- "Unknown" filter returned 0 contacts in the preview/unlock path even though the
-- breakdown counted them. Root cause: event_filtered_contact_ids (the canonical
-- helper behind get_event_filter_preview, unlock_event_contacts and reveal_emails)
-- matched each coalesced axis with a plain `col = any(selected)`, but a NULL axis
-- value buckets under the literal 'Unknown' in the facets — and `NULL = 'Unknown'`
-- is never true. event_filtered_facts and get_subscribed_event_contacts already got
-- the NULL branch (2026-06-22/23); this third helper was missed, so the count and
-- the list disagreed on every event for the seniority/function/industry/size/country
-- "Unknown" selection. Mirror the same NULL->'Unknown' branch here.
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
           or (co.industry_bucket is null and (p_filters->'industry') ? 'Unknown'))
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
