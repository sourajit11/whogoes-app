-- admin_data_quality is a 5-table join + aggregation over all ~120k
-- contact_event rows (contacts/events/posts/companies/primary emails). As a
-- plain view it recomputed on every read (~9s, intermittently hitting the
-- statement timeout / HTTP 500). The numbers change slowly (only as contacts
-- get enriched), so it's a textbook materialized view: compute once, refresh
-- on a schedule, read instantly.
--
-- Result: full-table read 9s -> ~1s, per-event filter (event-detail page)
-- 5.8s -> 0.27s. Output columns/order/types unchanged (verified Cannes
-- 3,227 / 2,378). Freshness bounded by the hourly refresh.
--
-- ONLY data-quality stats are materialized. Signups (admin_customer_overview),
-- payments, business stats and event popularity remain LIVE / real-time.
--
-- service_role only (the admin client). NOT granted to anon/authenticated: a
-- materialized view bakes in the data and would bypass the row-level security
-- that protected the plain view.
--
-- The DROP VIEW + CREATE MATERIALIZED VIEW swap runs in one transaction so the
-- relation is never left missing if anything fails (CREATE EXTENSION and the
-- cron.schedule run outside it; cron.schedule cannot live in the same tx as a
-- CONCURRENTLY refresh, but here it only registers the job).

CREATE EXTENSION IF NOT EXISTS pg_cron;

BEGIN;

DROP VIEW IF EXISTS public.admin_data_quality;

CREATE MATERIALIZED VIEW public.admin_data_quality AS
WITH primary_emails AS (
  SELECT DISTINCT contact_id
  FROM contact_emails
  WHERE is_primary = true AND email IS NOT NULL AND email <> ''
)
SELECT
  e.id AS event_id,
  e.name AS event_name,
  count(*) AS total_contacts,
  count(*) FILTER (WHERE pe.contact_id IS NOT NULL) AS with_email,
  count(*) FILTER (WHERE c.linkedin_url IS NOT NULL AND c.linkedin_url <> '') AS with_linkedin,
  count(*) FILTER (WHERE co.name IS NOT NULL AND co.name <> '') AS with_company,
  count(*) FILTER (WHERE c.current_title IS NOT NULL AND c.current_title <> '') AS with_title,
  count(*) FILTER (WHERE p.post_url IS NOT NULL AND p.post_url <> '') AS with_post_url,
  round(
    100.0 * count(*) FILTER (WHERE pe.contact_id IS NOT NULL)::numeric
    / NULLIF(count(*), 0)::numeric, 1
  ) AS email_rate,
  round(
    100.0 * count(*) FILTER (WHERE c.linkedin_url IS NOT NULL AND c.linkedin_url <> '')::numeric
    / NULLIF(count(*), 0)::numeric, 1
  ) AS linkedin_rate
FROM contact_events ce
  JOIN events e ON e.id = ce.event_id
  JOIN contacts c ON c.id = ce.contact_id
  LEFT JOIN posts p ON p.id = ce.post_id
  LEFT JOIN companies co ON co.id = c.current_company_id
  LEFT JOIN primary_emails pe ON pe.contact_id = c.id
GROUP BY e.id, e.name
ORDER BY count(*) DESC;

-- Unique index: required for REFRESH ... CONCURRENTLY and makes the per-event
-- filter (event-detail page) an index lookup.
CREATE UNIQUE INDEX idx_admin_data_quality_event
  ON public.admin_data_quality (event_id);

GRANT SELECT ON public.admin_data_quality TO service_role;

COMMIT;

-- Hourly refresh (CONCURRENTLY = no read lock during refresh).
SELECT cron.schedule(
  'refresh-admin-data-quality',
  '0 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.admin_data_quality$$
);
