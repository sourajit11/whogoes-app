-- Outreach pipeline: qualify events on TOTAL contacts instead of emailable contacts.
--
-- The caller now passes p_min_contacts = 200 (was 100 emailable). The
-- contacts_with_email column is still returned -- extract-core uses it as the
-- social-proof fallback when total_contacts is null -- it just no longer gates.

CREATE OR REPLACE FUNCTION public.get_pipeline_qualifying_events(p_start_date date, p_min_contacts integer)
 RETURNS TABLE(event_id uuid, event_name text, event_year integer, event_region text, event_location text, event_start_date date, is_active boolean, total_contacts bigint, contacts_with_email bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
  SELECT
    e.id, e.name, e.year, e.region, e.location, e.start_date, e.is_whogoes_active,
    COUNT(DISTINCT CASE
      WHEN COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
      THEN ce.contact_id END) AS total_contacts,
    COUNT(DISTINCT CASE
      WHEN cem.email IS NOT NULL
       AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
      THEN ce.contact_id END) AS contacts_with_email
  FROM events e
  LEFT JOIN contact_events ce ON ce.event_id = e.id
  LEFT JOIN contacts c ON c.id = ce.contact_id
  LEFT JOIN contact_emails cem ON cem.contact_id = ce.contact_id
  WHERE e.is_whogoes_active = true
    AND e.start_date >= p_start_date
  GROUP BY e.id, e.name, e.year, e.region, e.location, e.start_date, e.is_whogoes_active
  HAVING COUNT(DISTINCT CASE
      WHEN COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
      THEN ce.contact_id END) >= p_min_contacts;
$function$;

-- Pipeline calls this with the service-role key only; keep grants as they were.
REVOKE ALL ON FUNCTION public.get_pipeline_qualifying_events(date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pipeline_qualifying_events(date, integer) TO service_role;
