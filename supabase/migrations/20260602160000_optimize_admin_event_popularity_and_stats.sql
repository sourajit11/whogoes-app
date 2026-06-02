-- Speed up the admin overview page. admin_event_popularity recomputed
-- contact counts for ALL ~634 events on every load using count(DISTINCT
-- contact_id) plus a LEFT JOIN to contact_emails with count(DISTINCT CASE...),
-- which forces Sort+GroupAggregate (~2.9s). admin_get_business_stats ran 7
-- sequential COUNT(*)s (~2.9s). Both feed the main /admin page.
--
-- Same proven pattern as the browsable/event-count migrations:
--   - count(*) instead of count(DISTINCT contact_id) (safe: uq_contact_event)
--   - pre-deduped "primary email" CTE + count(*) FILTER instead of a
--     row-multiplying LEFT JOIN + count(DISTINCT CASE...)
-- Output is identical; just HashAggregate instead of disk-spilling sorts.
--
-- Supporting indexes for the per-event GROUP BYs and the month filter.

CREATE INDEX IF NOT EXISTS idx_cca_event_id
  ON public.customer_contact_access (event_id);

CREATE INDEX IF NOT EXISTS idx_cca_charged_at
  ON public.customer_contact_access (charged_at);

CREATE INDEX IF NOT EXISTS idx_ces_event_id
  ON public.customer_event_subscriptions (event_id);


-- =====================================================================
-- admin_event_popularity  (main /admin page, events list, analytics)
-- =====================================================================
CREATE OR REPLACE VIEW public.admin_event_popularity AS
WITH primary_emails AS (
  -- one row per contact that has a non-empty primary email
  SELECT DISTINCT contact_id
  FROM contact_emails
  WHERE is_primary = true AND email IS NOT NULL AND email <> ''
),
subs AS (
  SELECT event_id, count(DISTINCT user_id) AS subscriber_count
  FROM customer_event_subscriptions
  GROUP BY event_id
),
access AS (
  SELECT event_id, count(*) AS total_unlocks
  FROM customer_contact_access
  GROUP BY event_id
),
contact_stats AS (
  SELECT
    ce.event_id,
    count(*) AS total_contacts,
    count(*) FILTER (WHERE pe.contact_id IS NOT NULL) AS contacts_with_email
  FROM contact_events ce
  LEFT JOIN primary_emails pe ON pe.contact_id = ce.contact_id
  GROUP BY ce.event_id
)
SELECT
  e.id AS event_id,
  e.name AS event_name,
  e.year AS event_year,
  e.is_active,
  COALESCE(subs.subscriber_count, 0::bigint) AS subscriber_count,
  COALESCE(access.total_unlocks, 0::bigint) AS total_unlocks,
  COALESCE(contact_stats.total_contacts, 0::bigint) AS total_contacts,
  COALESCE(contact_stats.contacts_with_email, 0::bigint) AS contacts_with_email
FROM events e
LEFT JOIN subs ON subs.event_id = e.id
LEFT JOIN access ON access.event_id = e.id
LEFT JOIN contact_stats ON contact_stats.event_id = e.id
ORDER BY subs.subscriber_count DESC NULLS LAST;


-- =====================================================================
-- admin_get_business_stats  (single statement instead of 7 round-trips
-- inside plpgsql; the month filter now uses idx_cca_charged_at)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_get_business_stats()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT json_build_object(
    'total_users',            (SELECT count(*) FROM auth.users),
    'users_this_month',       (SELECT count(*) FROM auth.users
                                WHERE created_at >= date_trunc('month', now())),
    'total_credits_consumed', (SELECT count(*) FROM customer_contact_access),
    'credits_this_month',     (SELECT count(*) FROM customer_contact_access
                                WHERE charged_at >= date_trunc('month', now())),
    'total_events',           (SELECT count(*) FROM events),
    'active_events',          (SELECT count(*) FROM events WHERE is_active = true),
    'total_contacts',         (SELECT count(*) FROM contacts)
  );
$$;
