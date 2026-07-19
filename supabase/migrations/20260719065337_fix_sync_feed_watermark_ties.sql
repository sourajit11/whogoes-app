-- Fix the /api/v1/contacts sync feed watermark for bulk-unlock tie groups.
--
-- Problem: bulk unlocks stamp one charged_at on every row of the batch
-- (observed tie groups of 1,000-1,731 rows), while the feed pages at most
-- 200 rows and filters strictly `charged_at > p_since`. Once the page cap
-- lands inside a tie group, the returned watermark equals that timestamp
-- and the next call skips every undelivered row that shares it.
--
-- Fix: in sync mode (p_since given) a page stretches past p_limit to
-- include every remaining row that shares the final timestamp, so the
-- returned watermark always means "everything at or before this instant
-- has been delivered". Browse mode (no p_since) is unchanged.
-- The companion route fix stops truncating `since` to milliseconds.

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
      pe.post_url, pe.post_date, pe.source,
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
      SELECT p.post_url, p.posted_at AS post_date, ce.source_type AS source
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
