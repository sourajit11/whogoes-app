-- get_subscribed_events (the dashboard "Unlocked Events" / My Events list) was
-- the last RPC still applying the 3-hour "settled contact" anti-join, counting
--   total_contacts = contact_events whose contact was NOT updated in the last 3h.
--
-- Two problems with that:
--   1. Timeout. The anti-join materializes EVERY contact updated in the last
--      3 hours across the whole contacts table, then anti-joins it. During a
--      normal enrichment batch that is ~120k+ rows, pushing the RPC to ~7.5s
--      and over the authenticated 8s statement_timeout -> the page showed
--      "We couldn't load your unlocked events". Cost scaled with global scrape
--      volume, not with the user's own events, so it spiked unpredictably.
--   2. Inconsistency. Migration 20260622063839 already dropped this same settle
--      filter from get_event_unlock_status so the signed-in event header matches
--      the public get_event_by_slug page (count ALL contact_events). This list
--      still used the old filter, so My Events totals disagreed with the event
--      page and deflated during active scraping.
--
-- Fix: count total_contacts as ALL contact_events for the event (COUNT(*) ==
-- DISTINCT contact via uq_contact_event), matching the event page and the
-- public page. Bounds the query by the user's subscribed events only.
-- ~7.5s -> ~1.2s. The user-specific new/processed counts are unchanged.
-- Reversible: re-apply the prior body from the function's last definition.

CREATE OR REPLACE FUNCTION public.get_subscribed_events()
 RETURNS TABLE(event_id uuid, event_name text, event_year integer, event_region text, event_location text, event_start_date date, is_active boolean, is_whogoes_active boolean, subscribed_at timestamp with time zone, is_paused boolean, total_contacts bigint, new_contacts bigint, processed_contacts bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH my_subs AS (
    SELECT ces.event_id, ces.subscribed_at, ces.is_paused
    FROM customer_event_subscriptions ces
    WHERE ces.user_id = auth.uid()
  ),
  event_totals AS (
    SELECT ce.event_id, COUNT(*) AS total_contacts
    FROM contact_events ce
    WHERE ce.event_id IN (SELECT event_id FROM my_subs)
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
