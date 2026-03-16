-- ============================================
-- Migration: Fix get_subscribed_events RPC
-- Bug: total_contacts was returning the unlocked count (from customer_contact_access)
--       instead of the true total (from contact_events)
-- Fix: Use COUNT(DISTINCT contact_events.contact_id) for total_contacts
-- ============================================

-- Drop first because return type is changing
DROP FUNCTION IF EXISTS get_subscribed_events();

CREATE OR REPLACE FUNCTION get_subscribed_events()
RETURNS TABLE (
  event_id UUID,
  event_name TEXT,
  event_year INTEGER,
  event_region TEXT,
  event_location TEXT,
  event_start_date DATE,
  is_active BOOLEAN,
  subscribed_at TIMESTAMPTZ,
  is_paused BOOLEAN,
  total_contacts BIGINT,
  new_contacts BIGINT,
  processed_contacts BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id AS event_id,
    e.name AS event_name,
    e.year AS event_year,
    e.region AS event_region,
    e.location AS event_location,
    e.start_date AS event_start_date,
    e.is_active,
    ces.subscribed_at,
    ces.is_paused,
    -- TRUE total: count ALL contacts for this event (not just unlocked)
    (SELECT COUNT(DISTINCT ce.contact_id)
     FROM contact_events ce
     WHERE ce.event_id = e.id
    ) AS total_contacts,
    -- New = unlocked but not downloaded
    (SELECT COUNT(*)
     FROM customer_contact_access cca
     WHERE cca.user_id = auth.uid()
       AND cca.event_id = e.id
       AND cca.is_downloaded = false
    ) AS new_contacts,
    -- Processed = unlocked and downloaded
    (SELECT COUNT(*)
     FROM customer_contact_access cca
     WHERE cca.user_id = auth.uid()
       AND cca.event_id = e.id
       AND cca.is_downloaded = true
    ) AS processed_contacts
  FROM customer_event_subscriptions ces
  JOIN events e ON e.id = ces.event_id
  WHERE ces.user_id = auth.uid()
  ORDER BY ces.subscribed_at DESC;
END;
$$;
