-- Add server-side sort (p_sort_key / p_sort_dir) to get_subscribed_event_contacts so the
-- My Events table can stream rows already in display order. The client previously loaded
-- the whole event then sorted in-memory; progressive rendering made rows visibly reshuffle
-- because the RPC streamed in charged_at order while the client sorted by post date. With
-- the sort pushed down, each streamed batch only appends rows below what's shown, so the
-- first page is stable from the first batch.
--
-- Implementation: a `filtered` CTE applies the same access + ICP filters as before and
-- computes the sort keys; `page` assigns a row_number in the requested order and slices the
-- window (keeping the limit-before-heavy-join optimization); the outer query re-joins for
-- the full columns and orders by that row_number. Whitelisted sort keys only.
DROP FUNCTION IF EXISTS public.get_subscribed_event_contacts(uuid, text, integer, integer, jsonb);

CREATE FUNCTION public.get_subscribed_event_contacts(
  p_event_id uuid,
  p_filter text DEFAULT 'all'::text,
  p_limit integer DEFAULT NULL::integer,
  p_offset integer DEFAULT 0,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort_key text DEFAULT 'post_date'::text,
  p_sort_dir text DEFAULT 'desc'::text
)
RETURNS TABLE(contact_id uuid, full_name text, first_name text, last_name text, current_title text, headline text, contact_linkedin_url text, city text, country text, email text, email_status text, email_provider text, has_email boolean, email_unlocked boolean, company_name text, company_linkedin_url text, company_domain text, company_website text, company_industry text, company_size text, company_headquarters text, company_founded_year integer, company_description text, post_url text, post_content text, post_date timestamp with time zone, source text, first_line_personalization text, is_downloaded boolean, downloaded_at timestamp with time zone, event_role text, company_size_bucket text, company_industry_bucket text, is_speaker boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_asc boolean := lower(p_sort_dir) = 'asc';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM customer_event_subscriptions
    WHERE user_id = auth.uid() AND event_id = p_event_id
  ) THEN
    RAISE EXCEPTION 'Not subscribed to this event';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      cca.contact_id, cca.charged_at, cca.is_downloaded, cca.downloaded_at, cca.email_unlocked,
      -- Timestamp sort value (only for post_date); otherwise NULL so the text branch wins.
      CASE WHEN p_sort_key = 'post_date' THEN (
        SELECT max(p2.posted_at)
        FROM contact_events ce2 JOIN posts p2 ON p2.id = ce2.post_id
        WHERE ce2.contact_id = cca.contact_id AND ce2.event_id = p_event_id
      ) END AS sort_ts,
      -- Text sort value for the name/title/company/email columns.
      CASE p_sort_key
        WHEN 'full_name' THEN lower(c.full_name)
        WHEN 'current_title' THEN lower(c.current_title)
        WHEN 'company_name' THEN lower(co.name)
        WHEN 'email' THEN lower((
          SELECT e.email FROM contact_emails e
          WHERE e.contact_id = cca.contact_id AND e.status = 'valid'
          ORDER BY e.is_primary DESC NULLS LAST LIMIT 1
        ))
        ELSE NULL
      END AS sort_txt
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
      AND (not (p_filters ? 'seniority') or c.seniority_bucket = any(array(select jsonb_array_elements_text(p_filters->'seniority')))
           or (c.seniority_bucket is null and (p_filters->'seniority') ? 'Unknown'))
      AND (not (p_filters ? 'function')  or c.function_bucket  = any(array(select jsonb_array_elements_text(p_filters->'function')))
           or (c.function_bucket is null and (p_filters->'function') ? 'Unknown'))
      AND (not (p_filters ? 'industry')  or co.industry_bucket = any(array(select jsonb_array_elements_text(p_filters->'industry')))
           or (co.industry_bucket is null and (p_filters->'industry') ? 'Unknown'))
      AND (not (p_filters ? 'size')      or co.size_bucket     = any(array(select jsonb_array_elements_text(p_filters->'size')))
           or (co.size_bucket is null and (p_filters->'size') ? 'Unknown'))
      AND (not (p_filters ? 'country')   or c.country          = any(array(select jsonb_array_elements_text(p_filters->'country')))
           or (c.country is null and (p_filters->'country') ? 'Unknown'))
      AND (not (p_filters ? 'role')      or (
            case
              when coalesce(cer.role,'attendee') in ('organizer','sponsor','exhibitor') then cer.role
              when exists(select 1 from contact_events cep where cep.contact_id = cca.contact_id and cep.event_id = p_event_id and (cep.is_speaker = true or cep.source_type in ('post_author','mentioned'))) then 'attendee'
              else 'expected_attendee'
            end
          ) = any(array(select jsonb_array_elements_text(p_filters->'role'))))
      AND (not (p_filters ? 'speaker')   or (p_filters->>'speaker')::boolean is not true
           or exists(select 1 from contact_events ce2 where ce2.contact_id = cca.contact_id and ce2.event_id = p_event_id and ce2.is_speaker = true))
      AND (not (p_filters ? 'title_keyword') or p_filters->>'title_keyword' = ''
           or c.current_title ilike '%'||(p_filters->>'title_keyword')||'%'
           or c.headline ilike '%'||(p_filters->>'title_keyword')||'%')
      AND (not (p_filters ? 'company_include') or p_filters->>'company_include' = ''
           or co.name ilike '%'||(p_filters->>'company_include')||'%')
      AND (not (p_filters ? 'company_exclude') or p_filters->>'company_exclude' = ''
           or co.name is null or co.name not ilike '%'||(p_filters->>'company_exclude')||'%')
  ),
  page AS (
    SELECT f.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_asc THEN f.sort_ts END ASC NULLS LAST,
          CASE WHEN NOT v_asc THEN f.sort_ts END DESC NULLS LAST,
          CASE WHEN v_asc THEN f.sort_txt END ASC NULLS LAST,
          CASE WHEN NOT v_asc THEN f.sort_txt END DESC NULLS LAST,
          f.charged_at DESC
      ) AS rn
    FROM filtered f
    ORDER BY rn
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
    case
      when coalesce(cer.role,'attendee') in ('organizer','sponsor','exhibitor') then cer.role
      when exists(select 1 from contact_events cep2 where cep2.contact_id = c.id and cep2.event_id = p_event_id and (cep2.is_speaker = true or cep2.source_type in ('post_author','mentioned'))) then 'attendee'
      else 'expected_attendee'
    end AS event_role,
    co.size_bucket AS company_size_bucket,
    co.industry_bucket AS company_industry_bucket,
    exists(select 1 from contact_events ce3 where ce3.contact_id = c.id and ce3.event_id = p_event_id and ce3.is_speaker = true) AS is_speaker
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
  ORDER BY page.rn;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_subscribed_event_contacts(uuid, text, integer, integer, jsonb, text, text) TO authenticated, service_role;
