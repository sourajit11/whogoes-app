-- Add event_role + standardized company size/industry buckets to the My Events
-- contact rows so the Unlocked Events table can show a Role column and the new
-- bucketed Industry/Size columns (replacing free-text industry/size_range + HQ in UI).
-- Return type changed, so the function is dropped + recreated and re-granted.
DROP FUNCTION IF EXISTS public.get_subscribed_event_contacts(uuid,text,integer,integer,jsonb);

CREATE OR REPLACE FUNCTION public.get_subscribed_event_contacts(
  p_event_id uuid,
  p_filter text DEFAULT 'all'::text,
  p_limit integer DEFAULT NULL::integer,
  p_offset integer DEFAULT 0,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(
  contact_id uuid, full_name text, first_name text, last_name text, current_title text,
  headline text, contact_linkedin_url text, city text, country text, email text,
  email_status text, email_provider text, has_email boolean, email_unlocked boolean,
  company_name text, company_linkedin_url text, company_domain text, company_website text,
  company_industry text, company_size text, company_headquarters text, company_founded_year integer,
  company_description text, post_url text, post_content text, post_date timestamp with time zone,
  source text, first_line_personalization text, is_downloaded boolean, downloaded_at timestamp with time zone,
  event_role text, company_size_bucket text, company_industry_bucket text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
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
    page.is_downloaded, page.downloaded_at,
    coalesce(cer.role, 'attendee') AS event_role,
    co.size_bucket AS company_size_bucket,
    co.industry_bucket AS company_industry_bucket
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
  LEFT JOIN company_event_roles cer ON cer.event_id = p_event_id AND cer.company_id = c.current_company_id
  LEFT JOIN posts p ON ce.post_id = p.id
  ORDER BY page.charged_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_subscribed_event_contacts(uuid,text,integer,integer,jsonb) TO authenticated, anon, service_role;
