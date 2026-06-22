-- Denormalize "has a usable primary email" onto contacts so the ICP filter helpers no
-- longer run a per-query full scan of contact_emails (~1.6s on large events). Maintained
-- by a trigger on contact_emails. Same semantics as the old exists() check: a primary
-- email row with a non-empty address.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS has_primary_email boolean NOT NULL DEFAULT false;

-- Backfill (idempotent).
UPDATE public.contacts c
SET has_primary_email = EXISTS (
  SELECT 1 FROM contact_emails em
  WHERE em.contact_id = c.id AND em.is_primary
    AND em.email IS NOT NULL AND em.email <> ''
)
WHERE c.has_primary_email IS DISTINCT FROM EXISTS (
  SELECT 1 FROM contact_emails em
  WHERE em.contact_id = c.id AND em.is_primary
    AND em.email IS NOT NULL AND em.email <> ''
);

CREATE OR REPLACE FUNCTION public.sync_contact_has_primary_email(p_contact uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.contacts
  SET has_primary_email = EXISTS (
    SELECT 1 FROM contact_emails em
    WHERE em.contact_id = p_contact AND em.is_primary
      AND em.email IS NOT NULL AND em.email <> ''
  )
  WHERE id = p_contact;
$$;

CREATE OR REPLACE FUNCTION public.trg_contact_emails_sync_has_primary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_contact_has_primary_email(OLD.contact_id);
    RETURN OLD;
  END IF;
  PERFORM public.sync_contact_has_primary_email(NEW.contact_id);
  IF TG_OP = 'UPDATE' AND NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
    PERFORM public.sync_contact_has_primary_email(OLD.contact_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contact_emails_sync_has_primary ON public.contact_emails;
CREATE TRIGGER trg_contact_emails_sync_has_primary
AFTER INSERT OR UPDATE OR DELETE ON public.contact_emails
FOR EACH ROW EXECUTE FUNCTION public.trg_contact_emails_sync_has_primary();

-- Use the denormalized flag in the live filter helper (drives unlock + the facts refresh).
-- Identical predicates/output to the previous version (20260621165336) except has_email now
-- reads contacts.has_primary_email instead of an exists() subquery.
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
    order by ce.contact_id, coalesce(ce.is_speaker,false) desc, (ce.source_type in ('post_author','mentioned')) desc, ce.created_at desc nulls last
  ) sub
  where (not (p_filters ? 'role') or sub.role = any(array(select jsonb_array_elements_text(p_filters->'role'))));
$function$;
