-- Fix: selecting the "Unknown" bucket in event filters returned zero rows.
--
-- The facet builder (get_event_filter_facets) labels rows with a NULL axis value as
-- the literal key 'Unknown' via coalesce(col,'Unknown'). The filter (event_filtered_facts)
-- matched with `col = any(selected)`, but `NULL = 'Unknown'` is never true, so picking
-- "Unknown" matched nothing. This adds an explicit NULL branch on every coalesced axis
-- (seniority, function, industry, size, country) so "Unknown" matches the NULL rows it
-- was built from. Event role is excluded: it is never NULL.

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
         or (f.industry is null and (p_filters->'industry') ? 'Unknown'))
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
$function$
;
