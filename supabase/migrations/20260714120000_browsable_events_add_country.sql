-- Add event_country to get_all_browsable_events so the Browse Events tab can offer
-- a country filter (events are already segregated by country in events.country).
-- Adding a column to the RETURNS TABLE changes the return type, so CREATE OR REPLACE
-- alone is rejected ("cannot change return type of existing function") -- we DROP first.
-- Params are left unchanged: the browse list is fetched with no args and filtered
-- client-side, so country filtering needs the returned column, not a new SQL param.
DROP FUNCTION IF EXISTS public.get_all_browsable_events(integer, text, integer, integer, text);

CREATE OR REPLACE FUNCTION public.get_all_browsable_events(
  p_year integer DEFAULT NULL::integer,
  p_region text DEFAULT NULL::text,
  p_min_contacts integer DEFAULT NULL::integer,
  p_max_contacts integer DEFAULT NULL::integer,
  p_industry text DEFAULT NULL::text
)
RETURNS TABLE(event_id uuid, event_name text, event_year integer, event_region text, event_country text, event_location text, event_start_date date, event_industry text, is_active boolean, is_whogoes_active boolean, total_contacts bigint, contacts_with_email bigint, is_subscribed boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH recent_contacts AS (
    SELECT id
    FROM contacts
    WHERE COALESCE(updated_at, created_at) > NOW() - INTERVAL '1 hour'
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
    e.country AS event_country,
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
