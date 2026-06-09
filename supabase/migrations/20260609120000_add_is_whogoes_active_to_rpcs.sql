-- Add is_whogoes_active to get_all_browsable_events and get_subscribed_events RPCs.
-- Status badges in the app should reflect WhoGoes pipeline activity, not the generic is_active flag.

DROP FUNCTION IF EXISTS public.get_all_browsable_events(integer,text,integer,integer,text);
DROP FUNCTION IF EXISTS public.get_subscribed_events();

CREATE OR REPLACE FUNCTION public.get_all_browsable_events(
  p_year integer DEFAULT NULL::integer,
  p_region text DEFAULT NULL::text,
  p_min_contacts integer DEFAULT NULL::integer,
  p_max_contacts integer DEFAULT NULL::integer,
  p_industry text DEFAULT NULL::text
)
RETURNS TABLE(
  event_id uuid,
  event_name text,
  event_year integer,
  event_region text,
  event_location text,
  event_start_date date,
  event_industry text,
  is_active boolean,
  is_whogoes_active boolean,
  total_contacts bigint,
  contacts_with_email bigint,
  is_subscribed boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH recent_contacts AS (
    SELECT id
    FROM contacts
    WHERE COALESCE(updated_at, created_at) > NOW() - INTERVAL '3 hours'
  ),
  emails AS (
    SELECT DISTINCT contact_id
    FROM contact_emails
    WHERE email IS NOT NULL
  ),
  event_counts AS (
    SELECT
      ce.event_id,
      COUNT(*) AS total_contacts,
      COUNT(*) FILTER (WHERE em.contact_id IS NOT NULL) AS contacts_with_email
    FROM contact_events ce
    LEFT JOIN emails em ON em.contact_id = ce.contact_id
    WHERE NOT EXISTS (
      SELECT 1 FROM recent_contacts rc WHERE rc.id = ce.contact_id
    )
    GROUP BY ce.event_id
  ),
  user_subs AS (
    SELECT ces.event_id
    FROM customer_event_subscriptions ces
    WHERE ces.user_id = auth.uid()
  )
  SELECT
    e.id AS event_id,
    e.name AS event_name,
    e.year AS event_year,
    e.region AS event_region,
    e.location AS event_location,
    e.start_date AS event_start_date,
    e.industry AS event_industry,
    e.is_active,
    e.is_whogoes_active,
    COALESCE(ec.total_contacts, 0)::bigint AS total_contacts,
    COALESCE(ec.contacts_with_email, 0)::bigint AS contacts_with_email,
    (us.event_id IS NOT NULL) AS is_subscribed
  FROM events e
  LEFT JOIN event_counts ec ON ec.event_id = e.id
  LEFT JOIN user_subs us ON us.event_id = e.id
  WHERE (p_year IS NULL OR e.year = p_year)
    AND (p_region IS NULL OR e.region = p_region)
    AND (p_min_contacts IS NULL OR COALESCE(ec.total_contacts, 0) >= p_min_contacts)
    AND (p_max_contacts IS NULL OR COALESCE(ec.total_contacts, 0) <= p_max_contacts)
    AND (p_industry IS NULL OR e.industry = p_industry)
  ORDER BY e.start_date DESC NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.get_subscribed_events()
RETURNS TABLE(
  event_id uuid,
  event_name text,
  event_year integer,
  event_region text,
  event_location text,
  event_start_date date,
  is_active boolean,
  is_whogoes_active boolean,
  subscribed_at timestamp with time zone,
  is_paused boolean,
  total_contacts bigint,
  new_contacts bigint,
  processed_contacts bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH my_subs AS (
    SELECT ces.event_id, ces.subscribed_at, ces.is_paused
    FROM customer_event_subscriptions ces
    WHERE ces.user_id = auth.uid()
  ),
  recent_contacts AS (
    SELECT id FROM contacts
    WHERE COALESCE(updated_at, created_at) > NOW() - INTERVAL '3 hours'
  ),
  event_totals AS (
    SELECT ce.event_id, COUNT(*) AS total_contacts
    FROM contact_events ce
    WHERE ce.event_id IN (SELECT event_id FROM my_subs)
      AND NOT EXISTS (SELECT 1 FROM recent_contacts rc WHERE rc.id = ce.contact_id)
    GROUP BY ce.event_id
  ),
  user_access AS (
    SELECT cca.event_id,
      COUNT(*) FILTER (WHERE cca.is_downloaded = false) AS new_contacts,
      COUNT(*) FILTER (WHERE cca.is_downloaded = true)  AS processed_contacts
    FROM customer_contact_access cca
    WHERE cca.user_id = auth.uid()
      AND cca.event_id IN (SELECT event_id FROM my_subs)
    GROUP BY cca.event_id
  )
  SELECT
    e.id, e.name, e.year, e.region, e.location, e.start_date,
    e.is_active, e.is_whogoes_active,
    ms.subscribed_at, ms.is_paused,
    COALESCE(et.total_contacts, 0)::bigint,
    COALESCE(ua.new_contacts, 0)::bigint,
    COALESCE(ua.processed_contacts, 0)::bigint
  FROM my_subs ms
  JOIN events e ON e.id = ms.event_id
  LEFT JOIN event_totals et ON et.event_id = e.id
  LEFT JOIN user_access ua ON ua.event_id = e.id
  ORDER BY ms.subscribed_at DESC;
$function$;
