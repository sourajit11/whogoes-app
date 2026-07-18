-- ============================================
-- WhoGoes - Usage History by Date
-- Run AFTER 06-billing-rpcs.sql.
--
-- Fixes a confusing UX in /dashboard/billing: get_usage_history()
-- previously rolled all unlocks for an event under MIN(charged_at), so
-- users who unlocked from the same event on multiple days saw a single
-- row dated at their FIRST unlock. The number "credits used" was right;
-- the date next to it was wrong.
--
-- New shape: one row per (UTC date, event). Easy to scan, easy to export.
-- ============================================

DROP FUNCTION IF EXISTS get_usage_history();

CREATE OR REPLACE FUNCTION get_usage_history()
RETURNS TABLE (
  usage_date DATE,
  event_id UUID,
  event_name TEXT,
  credits_used BIGINT
)
LANGUAGE sql SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    (cca.charged_at AT TIME ZONE 'UTC')::date AS usage_date,
    cca.event_id,
    e.name AS event_name,
    COUNT(cca.id) AS credits_used
  FROM customer_contact_access cca
  JOIN events e ON e.id = cca.event_id
  WHERE cca.user_id = (select auth.uid())
  GROUP BY (cca.charged_at AT TIME ZONE 'UTC')::date, cca.event_id, e.name
  ORDER BY usage_date DESC, credits_used DESC;
$$;
