-- Lead processing: make "processed" an explicit customer action instead of a side
-- effect of downloading a CSV.
--
-- Before this migration, downloading a CSV silently flipped is_downloaded=true and
-- the UI displayed that as "Processed". Customers who work leads inside the platform
-- (open LinkedIn, send email, then move on) had no way to mark a lead done, and
-- customers who download a CSV just to look at it got every lead marked processed.
--
-- Now:
--   * is_downloaded / downloaded_at are reinterpreted as "processed" / "processed at"
--     (columns keep their names so every existing RPC, index and API keeps working).
--   * set_contacts_processed lets the user mark/unmark any of their own leads,
--     stamping downloaded_at with the processing time.
--   * lead_note stores a free-text note per (user, event, contact) row.
--   * get_subscribed_event_contacts returns lead_note so the table can show it.
--   * mark_contacts_downloaded stays for backward compatibility (API + old clients),
--     but the web download flow now only calls set_contacts_processed when the
--     customer opts in.

ALTER TABLE public.customer_contact_access
  ADD COLUMN IF NOT EXISTS lead_note text;

-- Mark/unmark the caller's own leads as processed. Unmarking clears the timestamp.
CREATE OR REPLACE FUNCTION public.set_contacts_processed(
  p_event_id uuid,
  p_contact_ids uuid[],
  p_processed boolean
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_updated integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  UPDATE customer_contact_access cca
  SET is_downloaded = p_processed,
      downloaded_at = CASE WHEN p_processed THEN now() ELSE NULL END
  WHERE cca.user_id = v_user_id
    AND cca.event_id = p_event_id
    AND cca.contact_id = ANY(p_contact_ids)
    AND cca.is_downloaded IS DISTINCT FROM p_processed;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN json_build_object(
    'success', true,
    'updated', v_updated,
    'processed_at', CASE WHEN p_processed THEN now() END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_contacts_processed(uuid, uuid[], boolean) TO authenticated;

-- Save a note on one of the caller's own leads. Empty/whitespace clears the note.
CREATE OR REPLACE FUNCTION public.set_contact_note(
  p_event_id uuid,
  p_contact_id uuid,
  p_note text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_note text := nullif(left(trim(coalesce(p_note, '')), 2000), '');
  v_updated integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authenticated');
  END IF;

  UPDATE customer_contact_access cca
  SET lead_note = v_note
  WHERE cca.user_id = v_user_id
    AND cca.event_id = p_event_id
    AND cca.contact_id = p_contact_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN json_build_object('success', false, 'message', 'Contact not found in your unlocked list');
  END IF;

  RETURN json_build_object('success', true, 'note', v_note);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_contact_note(uuid, uuid, text) TO authenticated;

-- Recreate get_subscribed_event_contacts with lead_note appended to the output.
-- Body is otherwise identical to 20260627213907 (server-side sort version).
DROP FUNCTION IF EXISTS public.get_subscribed_event_contacts(uuid, text, integer, integer, jsonb, text, text);

CREATE FUNCTION public.get_subscribed_event_contacts(
  p_event_id uuid,
  p_filter text DEFAULT 'all'::text,
  p_limit integer DEFAULT NULL::integer,
  p_offset integer DEFAULT 0,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort_key text DEFAULT 'post_date'::text,
  p_sort_dir text DEFAULT 'desc'::text
)
RETURNS TABLE(contact_id uuid, full_name text, first_name text, last_name text, current_title text, headline text, contact_linkedin_url text, city text, country text, email text, email_status text, email_provider text, has_email boolean, email_unlocked boolean, company_name text, company_linkedin_url text, company_domain text, company_website text, company_industry text, company_size text, company_headquarters text, company_founded_year integer, company_description text, post_url text, post_content text, post_date timestamp with time zone, source text, first_line_personalization text, is_downloaded boolean, downloaded_at timestamp with time zone, event_role text, company_size_bucket text, company_industry_bucket text, is_speaker boolean, lead_note text)
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
      cca.lead_note,
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
    exists(select 1 from contact_events ce3 where ce3.contact_id = c.id and ce3.event_id = p_event_id and ce3.is_speaker = true) AS is_speaker,
    page.lead_note
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
