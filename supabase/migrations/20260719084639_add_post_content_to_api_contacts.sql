-- Add post_content (full LinkedIn post text, never truncated) to both API
-- contact reads. The dashboard's My Events table already shows it; the API
-- returned only post_url/post_date/source. Souraa 2026-07-19: the post text
-- is core paid value (ready-made personalization + self-contained proof).
-- Signatures unchanged, so CREATE OR REPLACE preserves existing grants.

CREATE OR REPLACE FUNCTION public.api_get_unlocked_contacts(
  p_user_id uuid,
  p_event_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_sort_key text DEFAULT 'unlocked_at',
  p_sort_dir text DEFAULT 'desc'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_asc boolean := lower(COALESCE(p_sort_dir, 'desc')) = 'asc';
  v_key text := COALESCE(p_sort_key, 'unlocked_at');
  v_filtered boolean := COALESCE(p_filters, '{}'::jsonb) <> '{}'::jsonb;
  v_total integer;
  v_rows jsonb;
BEGIN
  IF v_key NOT IN ('unlocked_at', 'full_name', 'current_title', 'company_name', 'post_date', 'email') THEN
    v_key := 'unlocked_at';
  END IF;

  -- ICP filters restrict through the one shared helper instead of duplicating
  -- its predicates; materialized once so count + page reuse the same scan.
  DROP TABLE IF EXISTS _api_matched;
  CREATE TEMPORARY TABLE _api_matched (contact_id uuid PRIMARY KEY) ON COMMIT DROP;
  IF v_filtered THEN
    INSERT INTO _api_matched
    SELECT f.contact_id FROM public.event_filtered_contact_ids(p_event_id, p_filters) f;
  END IF;

  SELECT count(*) INTO v_total
  FROM customer_contact_access cca
  WHERE cca.user_id = p_user_id AND cca.event_id = p_event_id
    AND (NOT v_filtered OR EXISTS (SELECT 1 FROM _api_matched m WHERE m.contact_id = cca.contact_id));

  WITH scoped AS (
    SELECT cca.contact_id, cca.charged_at, cca.email_unlocked, cca.batch_id,
      CASE WHEN v_key = 'unlocked_at' THEN cca.charged_at
           WHEN v_key = 'post_date' THEN (
             SELECT max(p2.posted_at)
             FROM contact_events ce2 JOIN posts p2 ON p2.id = ce2.post_id
             WHERE ce2.contact_id = cca.contact_id AND ce2.event_id = p_event_id)
      END AS sort_ts,
      CASE v_key
        WHEN 'full_name' THEN lower(c.full_name)
        WHEN 'current_title' THEN lower(c.current_title)
        WHEN 'company_name' THEN lower(co.name)
        WHEN 'email' THEN lower((
          SELECT e.email FROM contact_emails e
          WHERE e.contact_id = cca.contact_id AND e.status = 'valid'
          ORDER BY e.is_primary DESC NULLS LAST LIMIT 1))
      END AS sort_txt
    FROM customer_contact_access cca
    JOIN contacts c ON c.id = cca.contact_id
    LEFT JOIN companies co ON co.id = c.current_company_id
    WHERE cca.user_id = p_user_id AND cca.event_id = p_event_id
      AND (NOT v_filtered OR EXISTS (SELECT 1 FROM _api_matched m WHERE m.contact_id = cca.contact_id))
  ),
  page AS (
    SELECT s.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_asc THEN s.sort_ts END ASC NULLS LAST,
          CASE WHEN NOT v_asc THEN s.sort_ts END DESC NULLS LAST,
          CASE WHEN v_asc THEN s.sort_txt END ASC NULLS LAST,
          CASE WHEN NOT v_asc THEN s.sort_txt END DESC NULLS LAST,
          s.charged_at DESC
      ) AS rn
    FROM scoped s
    ORDER BY rn
    LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_agg(to_jsonb(t) - 'rn' ORDER BY t.rn) INTO v_rows
  FROM (
    SELECT page.rn,
      c.id AS contact_id, c.full_name, c.first_name, c.last_name, c.current_title, c.headline,
      c.linkedin_url AS contact_linkedin_url, c.city, c.country,
      CASE WHEN page.email_unlocked THEN cem.email END AS email,
      CASE WHEN page.email_unlocked THEN cem.status END AS email_status,
      CASE WHEN page.email_unlocked THEN cem.provider END AS email_provider,
      (cem.email IS NOT NULL) AS has_email,
      page.email_unlocked,
      co.name AS company_name, co.linkedin_url AS company_linkedin_url, co.domain AS company_domain,
      co.website AS company_website, co.industry AS company_industry, co.size_range AS company_size,
      co.headquarters AS company_headquarters, co.founded_year AS company_founded_year,
      co.size_bucket AS company_size_bucket, co.industry_bucket AS company_industry_bucket,
      pe.post_url, pe.post_date, pe.source, pe.post_content,
      CASE
        WHEN COALESCE(cer.role, 'attendee') IN ('organizer', 'sponsor', 'exhibitor') THEN cer.role
        WHEN EXISTS (SELECT 1 FROM contact_events cep
                     WHERE cep.contact_id = c.id AND cep.event_id = p_event_id
                       AND (cep.is_speaker = true OR cep.source_type IN ('post_author', 'mentioned'))) THEN 'attendee'
        ELSE 'expected_attendee'
      END AS event_role,
      EXISTS (SELECT 1 FROM contact_events ce3
              WHERE ce3.contact_id = c.id AND ce3.event_id = p_event_id AND ce3.is_speaker = true) AS is_speaker,
      page.charged_at AS unlocked_at,
      page.batch_id
    FROM page
    JOIN contacts c ON c.id = page.contact_id
    LEFT JOIN LATERAL (
      SELECT e.email, e.status, e.provider
      FROM contact_emails e
      WHERE e.contact_id = c.id AND e.status = 'valid'
      ORDER BY e.is_primary DESC NULLS LAST
      LIMIT 1
    ) cem ON true
    LEFT JOIN companies co ON c.current_company_id = co.id
    LEFT JOIN company_event_roles cer ON cer.event_id = p_event_id AND cer.company_id = c.current_company_id
    LEFT JOIN LATERAL (
      SELECT p.post_url, p.posted_at AS post_date, ce.source_type AS source, p.content AS post_content
      FROM contact_events ce LEFT JOIN posts p ON p.id = ce.post_id
      WHERE ce.contact_id = c.id AND ce.event_id = p_event_id
      ORDER BY p.posted_at DESC NULLS LAST
      LIMIT 1
    ) pe ON true
  ) t;

  RETURN json_build_object(
    'contacts', COALESCE(v_rows, '[]'::jsonb),
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'has_more', (p_offset + p_limit) < v_total
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.api_get_all_unlocked_contacts(
  p_user_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_since timestamp with time zone DEFAULT NULL,
  p_event_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  -- With p_since the feed pages oldest-first so the caller can walk forward and
  -- persist the returned watermark; without it newest-first for browsing.
  v_asc boolean := p_since IS NOT NULL;
  v_total integer;
  v_rows jsonb;
  v_watermark timestamptz;
  v_returned integer;
BEGIN
  SELECT count(*) INTO v_total
  FROM customer_contact_access cca
  WHERE cca.user_id = p_user_id
    AND (p_since IS NULL OR cca.charged_at > p_since)
    AND (p_event_id IS NULL OR cca.event_id = p_event_id);

  WITH ordered AS (
    SELECT cca.contact_id, cca.event_id, cca.charged_at, cca.email_unlocked, cca.batch_id,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_asc THEN cca.charged_at END ASC,
          CASE WHEN NOT v_asc THEN cca.charged_at END DESC,
          cca.id
      ) AS rn
    FROM customer_contact_access cca
    WHERE cca.user_id = p_user_id
      AND (p_since IS NULL OR cca.charged_at > p_since)
      AND (p_event_id IS NULL OR cca.event_id = p_event_id)
  ),
  boundary AS (
    SELECT max(charged_at) AS last_ts
    FROM ordered
    WHERE rn > p_offset AND rn <= p_offset + p_limit
  ),
  page AS (
    SELECT o.contact_id, o.event_id, o.charged_at, o.email_unlocked, o.batch_id, o.rn
    FROM ordered o, boundary b
    WHERE o.rn > p_offset
      AND (o.rn <= p_offset + p_limit
           OR (v_asc AND o.charged_at = b.last_ts))
  )
  SELECT jsonb_agg(to_jsonb(t) - 'rn' ORDER BY t.rn), max(t.unlocked_at), count(*)
  INTO v_rows, v_watermark, v_returned
  FROM (
    SELECT page.rn,
      page.event_id, e.name AS event_name, e.slug AS event_slug,
      c.id AS contact_id, c.full_name, c.first_name, c.last_name, c.current_title, c.headline,
      c.linkedin_url AS contact_linkedin_url, c.city, c.country,
      CASE WHEN page.email_unlocked THEN cem.email END AS email,
      CASE WHEN page.email_unlocked THEN cem.status END AS email_status,
      CASE WHEN page.email_unlocked THEN cem.provider END AS email_provider,
      (cem.email IS NOT NULL) AS has_email,
      page.email_unlocked,
      co.name AS company_name, co.linkedin_url AS company_linkedin_url, co.domain AS company_domain,
      co.website AS company_website, co.industry AS company_industry, co.size_range AS company_size,
      co.headquarters AS company_headquarters, co.founded_year AS company_founded_year,
      co.size_bucket AS company_size_bucket, co.industry_bucket AS company_industry_bucket,
      pe.post_url, pe.post_date, pe.source, pe.post_content,
      CASE
        WHEN COALESCE(cer.role, 'attendee') IN ('organizer', 'sponsor', 'exhibitor') THEN cer.role
        WHEN EXISTS (SELECT 1 FROM contact_events cep
                     WHERE cep.contact_id = c.id AND cep.event_id = page.event_id
                       AND (cep.is_speaker = true OR cep.source_type IN ('post_author', 'mentioned'))) THEN 'attendee'
        ELSE 'expected_attendee'
      END AS event_role,
      EXISTS (SELECT 1 FROM contact_events ce3
              WHERE ce3.contact_id = c.id AND ce3.event_id = page.event_id AND ce3.is_speaker = true) AS is_speaker,
      page.charged_at AS unlocked_at,
      page.batch_id
    FROM page
    JOIN events e ON e.id = page.event_id
    JOIN contacts c ON c.id = page.contact_id
    LEFT JOIN LATERAL (
      SELECT em.email, em.status, em.provider
      FROM contact_emails em
      WHERE em.contact_id = c.id AND em.status = 'valid'
      ORDER BY em.is_primary DESC NULLS LAST
      LIMIT 1
    ) cem ON true
    LEFT JOIN companies co ON c.current_company_id = co.id
    LEFT JOIN company_event_roles cer ON cer.event_id = page.event_id AND cer.company_id = c.current_company_id
    LEFT JOIN LATERAL (
      SELECT p.post_url, p.posted_at AS post_date, ce.source_type AS source, p.content AS post_content
      FROM contact_events ce LEFT JOIN posts p ON p.id = ce.post_id
      WHERE ce.contact_id = c.id AND ce.event_id = page.event_id
      ORDER BY p.posted_at DESC NULLS LAST
      LIMIT 1
    ) pe ON true
  ) t;

  RETURN json_build_object(
    'contacts', COALESCE(v_rows, '[]'::jsonb),
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'since', p_since,
    'watermark', v_watermark,
    'has_more', (p_offset + COALESCE(v_returned, 0)) < v_total
  );
END;
$function$;
