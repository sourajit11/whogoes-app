-- One canonical "with email" definition everywhere: a contact counts as having an
-- email iff it has a contact_emails row with status = 'valid' and a non-empty email.
--
-- Before this, the event page header (get_event_unlock_status: live join on valid
-- emails) and the filter bar / facets (event_filtered_contact_ids: contacts.
-- has_primary_email flag) could disagree on the same screen (e.g. Develop:Brighton
-- 1,131 vs 1,111). The 20-contact gap was flag drift: emails inserted empty and
-- later updated to valid never got is_primary set, because the autoprimary trigger
-- only fired on INSERT, so has_primary_email stayed false.
--
-- This migration:
--   1) switches event_filtered_contact_ids (facets, filtered preview, unlock
--      ordering, reveal scope) to the valid-email definition
--   2) does the same for the denormalized event_contact_facts refresher
--      (audit / pipeline consumers)
--   3) fires the autoprimary trigger on UPDATE as well as INSERT so primary
--      hygiene can't drift again (reveal/display pick emails by is_primary)
--   4) backfills is_primary for the contacts that already drifted

-- 1) Live filter helper: has_email = valid email exists.
--    idx_contact_emails_lookup (contact_id, status) makes the EXISTS a cheap probe.
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
  where (not (p_filters ? 'role') or sub.role = any(array(select jsonb_array_elements_text(p_filters->'role'))));
$function$;

-- 2) Denormalized facts refresher: same definition.
CREATE OR REPLACE FUNCTION public.refresh_event_contact_facts(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
BEGIN
  DELETE FROM public.event_contact_facts WHERE event_id = p_event_id;
  INSERT INTO public.event_contact_facts
    (event_id, contact_id, created_at, has_email, seniority, func, country, industry, sizeb, company_name, role, is_speaker, title_search)
  SELECT p_event_id, contact_id, created_at, has_email, seniority, func, country, industry, sizeb, company_name, role, is_speaker, title_search
  FROM (
    SELECT DISTINCT ON (ce.contact_id)
      ce.contact_id,
      ce.created_at,
      EXISTS (
        SELECT 1 FROM contact_emails em
        WHERE em.contact_id = ce.contact_id
          AND em.status = 'valid'
          AND em.email IS NOT NULL AND em.email <> ''
      ) AS has_email,
      c.seniority_bucket AS seniority, c.function_bucket AS func, c.country AS country,
      co.industry_bucket AS industry, co.size_bucket AS sizeb, co.name AS company_name,
      CASE
        WHEN coalesce(cer.role,'attendee') IN ('organizer','sponsor','exhibitor') THEN cer.role
        WHEN coalesce(ce.is_speaker,false) OR ce.source_type IN ('post_author','mentioned') THEN 'attendee'
        ELSE 'expected_attendee'
      END AS role,
      coalesce(ce.is_speaker,false) AS is_speaker,
      coalesce(c.current_title,'') || ' ' || coalesce(c.headline,'') AS title_search
    FROM contact_events ce
    JOIN contacts c ON c.id = ce.contact_id
    LEFT JOIN companies co ON co.id = c.current_company_id
    LEFT JOIN company_event_roles cer ON cer.event_id = p_event_id AND cer.company_id = c.current_company_id
    WHERE ce.event_id = p_event_id
    ORDER BY ce.contact_id, coalesce(ce.is_speaker,false) DESC,
             (ce.source_type IN ('post_author','mentioned')) DESC, ce.created_at DESC NULLS LAST
  ) sub;
END;
$function$;

-- 3) Autoprimary on UPDATE too: an email row inserted empty/unverified and later
--    verified (UPDATE of email/status) now gets promoted to primary when the
--    contact has none. Previously only INSERT fired, which is how drift happened.
DROP TRIGGER IF EXISTS trg_contact_emails_autoprimary ON public.contact_emails;
CREATE TRIGGER trg_contact_emails_autoprimary
  BEFORE INSERT OR UPDATE OF email, status ON public.contact_emails
  FOR EACH ROW EXECUTE FUNCTION public.trg_contact_emails_autoprimary();

-- 4) Backfill: contacts with a valid email but no primary email row get their
--    oldest valid email promoted. The existing sync trigger cascades
--    contacts.has_primary_email from this update.
WITH candidates AS (
  SELECT DISTINCT ON (em.contact_id) em.id
  FROM public.contact_emails em
  WHERE em.status = 'valid'
    AND em.email IS NOT NULL AND em.email <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.contact_emails p
      WHERE p.contact_id = em.contact_id
        AND p.is_primary
        AND p.email IS NOT NULL AND p.email <> ''
    )
  ORDER BY em.contact_id, em.created_at ASC
)
UPDATE public.contact_emails em
SET is_primary = true
FROM candidates c
WHERE em.id = c.id;
