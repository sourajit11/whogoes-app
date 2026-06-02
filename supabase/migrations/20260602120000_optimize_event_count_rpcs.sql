-- Optimize the three RPCs that still recompute event-wide contact counts with
-- per-event correlated COUNT(DISTINCT ...) subqueries on every request. These
-- intermittently bust Supabase's statement_timeout, surfacing as:
--   - get_subscribed_events: the dashboard "Unlocked Events" / "My Unlocked
--     Events" failing to load for heavy accounts (e.g. 20 events / 8,455
--     contacts) — the total_contacts subquery runs once PER subscribed event.
--   - get_event_by_slug: the public /events/[slug] page 404-ing for large
--     events (e.g. Cannes Lions 2026, 3,227 contacts) because the page treats
--     the RPC timeout as "event not found".
--   - get_event_unlock_status: same cost on every event-detail load.
--
-- Root cause + fix are identical to what was already done for
-- get_all_browsable_events in 20260515000000_optimize_browsable_events_v2.sql:
--   1. contact_events has UNIQUE (contact_id, event_id) (uq_contact_event), so
--      COUNT(*) per event_id == COUNT(DISTINCT contact_id). COUNT(*) lets the
--      planner use a HashAggregate instead of Sort+GroupAggregate (disk spill).
--   2. The "3-hour-settled" filter excludes ~0.3% of rows, so an INNER JOIN to
--      contacts scanned the whole 116k-row table to keep almost everything.
--      Replace it with an anti-join against the small set of "recent" contacts,
--      served by idx_contacts_settled_at.
--   3. get_subscribed_events computed counts with N correlated subqueries (one
--      pass per event). Replace with a single set-based aggregation scoped to
--      the user's subscribed events.
--
-- Semantics preserved EXACTLY (same RETURNS shapes, same numbers):
--   - get_subscribed_events.total_contacts: settled DISTINCT contacts -> COUNT(*)
--     anti-joined against recent contacts. new/processed: per-user FILTER counts.
--   - get_event_by_slug.total_contacts: ALL contact_events (no settle filter,
--     unchanged). contacts_with_email: status='valid' (unchanged).
--   - get_event_unlock_status: settled total + is_primary email count (unchanged);
--     user-specific unlocked/balance/is_subscribed logic untouched.
--
-- No schema change, no backfill. Fully reversible (re-apply the prior bodies).

-- Indexes the rewrites rely on (idempotent; idx_contacts_settled_at already
-- exists from the browsable v2 migration, repeated here so this file is
-- self-contained).
CREATE INDEX IF NOT EXISTS idx_contacts_settled_at
  ON public.contacts ((COALESCE(updated_at, created_at)));

CREATE INDEX IF NOT EXISTS idx_contact_events_event_id
  ON public.contact_events (event_id);

CREATE INDEX IF NOT EXISTS idx_cca_user_event_downloaded
  ON public.customer_contact_access (user_id, event_id, is_downloaded);


-- =====================================================================
-- get_subscribed_events  (the one timing out on the dashboard now)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_subscribed_events()
RETURNS TABLE(
  event_id uuid,
  event_name text,
  event_year integer,
  event_region text,
  event_location text,
  event_start_date date,
  is_active boolean,
  subscribed_at timestamp with time zone,
  is_paused boolean,
  total_contacts bigint,
  new_contacts bigint,
  processed_contacts bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH my_subs AS (
    SELECT ces.event_id, ces.subscribed_at, ces.is_paused
    FROM customer_event_subscriptions ces
    WHERE ces.user_id = auth.uid()
  ),
  recent_contacts AS (
    SELECT id
    FROM contacts
    WHERE COALESCE(updated_at, created_at) > NOW() - INTERVAL '3 hours'
  ),
  event_totals AS (
    -- One pass over only the user's subscribed events. COUNT(*) == DISTINCT
    -- contact_id thanks to uq_contact_event. Anti-join = "settled" contacts.
    SELECT ce.event_id, COUNT(*) AS total_contacts
    FROM contact_events ce
    WHERE ce.event_id IN (SELECT event_id FROM my_subs)
      AND NOT EXISTS (
        SELECT 1 FROM recent_contacts rc WHERE rc.id = ce.contact_id
      )
    GROUP BY ce.event_id
  ),
  user_access AS (
    SELECT
      cca.event_id,
      COUNT(*) FILTER (WHERE cca.is_downloaded = false) AS new_contacts,
      COUNT(*) FILTER (WHERE cca.is_downloaded = true)  AS processed_contacts
    FROM customer_contact_access cca
    WHERE cca.user_id = auth.uid()
      AND cca.event_id IN (SELECT event_id FROM my_subs)
    GROUP BY cca.event_id
  )
  SELECT
    e.id AS event_id,
    e.name AS event_name,
    e.year AS event_year,
    e.region AS event_region,
    e.location AS event_location,
    e.start_date AS event_start_date,
    e.is_active,
    ms.subscribed_at,
    ms.is_paused,
    COALESCE(et.total_contacts, 0)::bigint    AS total_contacts,
    COALESCE(ua.new_contacts, 0)::bigint      AS new_contacts,
    COALESCE(ua.processed_contacts, 0)::bigint AS processed_contacts
  FROM my_subs ms
  JOIN events e ON e.id = ms.event_id
  LEFT JOIN event_totals et ON et.event_id = e.id
  LEFT JOIN user_access ua ON ua.event_id = e.id
  ORDER BY ms.subscribed_at DESC;
$$;


-- =====================================================================
-- get_event_by_slug  (public event page; was 404-ing for large events)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_event_by_slug(p_slug text)
RETURNS TABLE(
  event_id uuid,
  event_name text,
  event_year integer,
  event_region text,
  event_location text,
  event_start_date date,
  event_slug text,
  is_active boolean,
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
  -- "with email" preserved as status='valid' (this function's original
  -- definition), scoped to this event's contacts.
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


-- =====================================================================
-- get_event_unlock_status  (event-detail load; same per-event count cost)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_event_unlock_status(p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_total INTEGER;
  v_with_email INTEGER;
  v_unlocked INTEGER := 0;
  v_balance INTEGER := 0;
  v_is_subscribed BOOLEAN := false;
BEGIN
  v_user_id := auth.uid();

  -- Settled total (COUNT(*) == DISTINCT via uq_contact_event; anti-join settle).
  SELECT COUNT(*) INTO v_total
  FROM contact_events ce
  WHERE ce.event_id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = ce.contact_id
        AND COALESCE(c.updated_at, c.created_at) > NOW() - INTERVAL '3 hours'
    );

  -- Contacts with verified email — preserved definition: a primary, non-empty
  -- email, settled. Scoped to this event's contacts.
  SELECT COUNT(*) INTO v_with_email
  FROM contact_events ce
  WHERE ce.event_id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM contacts c
      WHERE c.id = ce.contact_id
        AND COALESCE(c.updated_at, c.created_at) > NOW() - INTERVAL '3 hours'
    )
    AND EXISTS (
      SELECT 1 FROM contact_emails em
      WHERE em.contact_id = ce.contact_id
        AND em.is_primary = true
        AND em.email IS NOT NULL
        AND em.email <> ''
    );

  IF v_user_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_unlocked
    FROM customer_contact_access
    WHERE user_id = v_user_id AND event_id = p_event_id;

    SELECT COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0)
    INTO v_balance
    FROM user_signups us
    LEFT JOIN customers c ON c.user_id = us.user_id
    WHERE us.user_id = v_user_id;

    v_balance := COALESCE(v_balance, 0);

    SELECT EXISTS(
      SELECT 1 FROM customer_event_subscriptions
      WHERE user_id = v_user_id AND event_id = p_event_id
    ) INTO v_is_subscribed;
  END IF;

  RETURN json_build_object(
    'total_contacts', v_total,
    'unlocked_count', v_unlocked,
    'remaining_count', v_total - v_unlocked,
    'contacts_with_email', v_with_email,
    'user_balance', v_balance,
    'is_subscribed', v_is_subscribed
  );
END;
$function$;
