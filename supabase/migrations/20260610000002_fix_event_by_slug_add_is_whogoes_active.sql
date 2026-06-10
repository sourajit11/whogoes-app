-- Add is_whogoes_active to get_event_by_slug.
--
-- The public event page (/events/[slug]) calls this RPC and renders a
-- status badge from event.is_whogoes_active. Because this field was missing
-- from the RETURNS shape, event.is_whogoes_active was always undefined on
-- public pages, so the badge always showed "Data Collection Complete"
-- regardless of the actual flag value.

DROP FUNCTION IF EXISTS public.get_event_by_slug(text);

CREATE FUNCTION public.get_event_by_slug(p_slug text)
RETURNS TABLE(
  event_id uuid,
  event_name text,
  event_year integer,
  event_region text,
  event_location text,
  event_start_date date,
  event_slug text,
  is_active boolean,
  is_whogoes_active boolean,
  total_contacts bigint,
  contacts_with_email bigint,
  is_subscribed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH ev AS (
    SELECT * FROM events WHERE slug = p_slug
  ),
  valid_emails AS (
    SELECT DISTINCT cem.contact_id
    FROM contact_emails cem
    WHERE cem.status = 'valid'
      AND cem.contact_id IN (
        SELECT ce.contact_id FROM contact_events ce
        WHERE ce.event_id = (SELECT id FROM ev)
      )
  ),
  counts AS (
    SELECT
      COUNT(*) AS total_contacts,
      COUNT(*) FILTER (WHERE ve.contact_id IS NOT NULL) AS contacts_with_email
    FROM contact_events ce
    LEFT JOIN valid_emails ve ON ve.contact_id = ce.contact_id
    WHERE ce.event_id = (SELECT id FROM ev)
  )
  SELECT
    e.id AS event_id,
    e.name AS event_name,
    e.year AS event_year,
    e.region AS event_region,
    e.location AS event_location,
    e.start_date AS event_start_date,
    e.slug AS event_slug,
    e.is_active,
    e.is_whogoes_active,
    COALESCE(cnt.total_contacts, 0)::bigint AS total_contacts,
    COALESCE(cnt.contacts_with_email, 0)::bigint AS contacts_with_email,
    COALESCE(
      (SELECT true FROM customer_event_subscriptions ces
       WHERE ces.user_id = auth.uid() AND ces.event_id = e.id),
      false
    ) AS is_subscribed
  FROM ev e
  CROSS JOIN counts cnt;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_event_by_slug(text) TO authenticated, anon, service_role;
