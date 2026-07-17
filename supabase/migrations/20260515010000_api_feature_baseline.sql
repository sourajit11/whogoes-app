-- Baseline migration for the Whogoes public REST API feature.
-- Captured 2026-05-15 from the live remote database. Until now these objects
-- existed only in production without a tracked migration. Recording them here
-- so the schema can be rebuilt from scratch (staging, disaster recovery, new
-- environment) and so future db push commands see a clean lineage.
--
-- Everything below is written to be idempotent: it uses CREATE TABLE IF NOT
-- EXISTS, CREATE INDEX IF NOT EXISTS, and CREATE OR REPLACE FUNCTION. Policy
-- DROP-then-CREATE pattern handles re-runs cleanly. Re-running this against
-- the live DB should produce no changes.

-- ============================================================
-- Tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  name text DEFAULT 'Default'::text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  daily_credit_cap integer,
  created_at timestamptz DEFAULT now() NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (id),
  CONSTRAINT api_keys_daily_cap_non_negative CHECK (((daily_credit_cap IS NULL) OR (daily_credit_cap >= 0))),
  CONSTRAINT api_keys_hash_unique UNIQUE (key_hash),
  CONSTRAINT api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.api_usage_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  api_key_id uuid NOT NULL,
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  method text NOT NULL,
  status_code integer NOT NULL,
  credits_used integer DEFAULT 0 NOT NULL,
  request_ip text,
  request_timestamp timestamptz DEFAULT now() NOT NULL,
  response_time_ms integer,
  idempotency_key text,
  response_body jsonb,
  PRIMARY KEY (id),
  CONSTRAINT api_usage_idem_unique UNIQUE (api_key_id, idempotency_key),
  CONSTRAINT api_usage_log_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE,
  CONSTRAINT api_usage_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- ============================================================
-- Row-Level Security
-- ============================================================

DROP POLICY IF EXISTS "Users can insert own api keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users can read own api keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users can update own api keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users can read own usage logs" ON public.api_usage_log;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert own api keys" ON public.api_keys
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can read own api keys" ON public.api_keys
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can update own api keys" ON public.api_keys
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((auth.uid() = user_id));
CREATE POLICY "Users can read own usage logs" ON public.api_usage_log
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() = user_id));

-- ============================================================
-- Indexes (non-constraint)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys USING btree (key_hash) WHERE (is_active = true);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_daily_cap ON public.api_usage_log USING btree (api_key_id, request_timestamp) WHERE (credits_used > 0);
CREATE INDEX IF NOT EXISTS idx_api_usage_key_time ON public.api_usage_log USING btree (api_key_id, request_timestamp DESC);

-- ============================================================
-- Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.api_daily_credit_spend(p_api_key_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_spent INTEGER;
BEGIN
  SELECT COALESCE(SUM(credits_used), 0) INTO v_spent
  FROM api_usage_log
  WHERE api_key_id = p_api_key_id
    AND request_timestamp >= date_trunc('day', now() AT TIME ZONE 'UTC')
    AND credits_used > 0;
  RETURN v_spent;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.api_get_all_unlocked_contacts(p_user_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total INTEGER;
  v_contacts JSON;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM customer_contact_access cca
  WHERE cca.user_id = p_user_id
    AND (p_since IS NULL OR cca.charged_at >= p_since);

  SELECT json_agg(row_to_json(t)) INTO v_contacts
  FROM (
    SELECT
      cca.event_id,
      e.name AS event_name,
      e.slug AS event_slug,
      c.id AS contact_id,
      c.full_name,
      c.first_name,
      c.last_name,
      c.current_title,
      c.headline,
      c.linkedin_url AS contact_linkedin_url,
      c.city,
      c.country,
      cem.email,
      cem.status AS email_status,
      cem.provider AS email_provider,
      co.name AS company_name,
      co.linkedin_url AS company_linkedin_url,
      co.domain AS company_domain,
      co.website AS company_website,
      co.industry AS company_industry,
      co.size_range AS company_size,
      co.headquarters AS company_headquarters,
      co.founded_year AS company_founded_year,
      p.post_url,
      p.posted_at AS post_date,
      ce.source_type AS source,
      cca.charged_at,
      cca.is_downloaded
    FROM customer_contact_access cca
    JOIN events e ON e.id = cca.event_id
    JOIN contacts c ON c.id = cca.contact_id
    LEFT JOIN contact_events ce ON ce.contact_id = c.id AND ce.event_id = cca.event_id
    LEFT JOIN LATERAL (
      SELECT em.email, em.status, em.provider
      FROM contact_emails em
      WHERE em.contact_id = c.id AND em.status = 'valid'
      ORDER BY em.is_primary DESC NULLS LAST
      LIMIT 1
    ) cem ON true
    LEFT JOIN companies co ON c.current_company_id = co.id
    LEFT JOIN posts p ON ce.post_id = p.id
    WHERE cca.user_id = p_user_id
      AND (p_since IS NULL OR cca.charged_at >= p_since)
    ORDER BY cca.charged_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  RETURN json_build_object(
    'contacts', COALESCE(v_contacts, '[]'::json),
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'since', p_since,
    'has_more', (p_offset + p_limit) < v_total
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.api_get_event_unlock_status(p_user_id uuid, p_event_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total INTEGER;
  v_with_email INTEGER;
  v_unlocked INTEGER := 0;
  v_balance INTEGER := 0;
  v_is_subscribed BOOLEAN := false;
BEGIN
  SELECT COUNT(DISTINCT c.id) INTO v_total
  FROM contacts c
  JOIN contact_events ce ON ce.contact_id = c.id
  WHERE ce.event_id = p_event_id
    AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours';

  SELECT COUNT(DISTINCT ce.contact_id) INTO v_with_email
  FROM contact_events ce
  JOIN contacts c ON c.id = ce.contact_id
  JOIN contact_emails em ON em.contact_id = ce.contact_id AND em.is_primary = true
  WHERE ce.event_id = p_event_id
    AND em.email IS NOT NULL
    AND em.email != ''
    AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours';

  IF p_user_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_unlocked
    FROM customer_contact_access
    WHERE user_id = p_user_id AND event_id = p_event_id;

    v_balance := api_get_user_credits(p_user_id);

    SELECT EXISTS(
      SELECT 1 FROM customer_event_subscriptions
      WHERE user_id = p_user_id AND event_id = p_event_id
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
$function$
;

CREATE OR REPLACE FUNCTION public.api_get_unlocked_contacts(p_user_id uuid, p_event_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total INTEGER;
  v_contacts JSON;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM customer_contact_access cca
  WHERE cca.user_id = p_user_id AND cca.event_id = p_event_id;

  SELECT json_agg(row_to_json(t)) INTO v_contacts
  FROM (
    SELECT
      c.id AS contact_id,
      c.full_name,
      c.first_name,
      c.last_name,
      c.current_title,
      c.headline,
      c.linkedin_url AS contact_linkedin_url,
      c.city,
      c.country,
      cem.email,
      cem.status AS email_status,
      cem.provider AS email_provider,
      co.name AS company_name,
      co.linkedin_url AS company_linkedin_url,
      co.domain AS company_domain,
      co.website AS company_website,
      co.industry AS company_industry,
      co.size_range AS company_size,
      co.headquarters AS company_headquarters,
      co.founded_year AS company_founded_year,
      p.post_url,
      p.posted_at AS post_date,
      ce.source_type AS source,
      cca.charged_at,
      cca.is_downloaded
    FROM customer_contact_access cca
    JOIN contacts c ON c.id = cca.contact_id
    LEFT JOIN contact_events ce ON ce.contact_id = c.id AND ce.event_id = cca.event_id
    LEFT JOIN LATERAL (
      SELECT e.email, e.status, e.provider
      FROM contact_emails e
      WHERE e.contact_id = c.id AND e.status = 'valid'
      ORDER BY e.is_primary DESC NULLS LAST
      LIMIT 1
    ) cem ON true
    LEFT JOIN companies co ON c.current_company_id = co.id
    LEFT JOIN posts p ON ce.post_id = p.id
    WHERE cca.user_id = p_user_id AND cca.event_id = p_event_id
    ORDER BY cca.charged_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  RETURN json_build_object(
    'contacts', COALESCE(v_contacts, '[]'::json),
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'has_more', (p_offset + p_limit) < v_total
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.api_get_user_credits(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_free INTEGER;
  v_paid INTEGER;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  SELECT COALESCE(free_credits, 0) INTO v_free FROM user_signups WHERE user_id = p_user_id;
  SELECT COALESCE(credits_balance, 0) INTO v_paid FROM customers WHERE user_id = p_user_id;
  RETURN COALESCE(v_free, 0) + COALESCE(v_paid, 0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.api_list_events()
 RETURNS TABLE(event_id uuid, event_name text, event_slug text, event_year integer, event_region text, event_location text, event_start_date date, is_active boolean, total_contacts bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH counts AS (
    SELECT event_id, COUNT(*)::bigint AS total_contacts
    FROM contact_events
    GROUP BY event_id
  )
  SELECT
    e.id AS event_id,
    e.name AS event_name,
    e.slug AS event_slug,
    e.year AS event_year,
    e.region AS event_region,
    e.location AS event_location,
    e.start_date AS event_start_date,
    e.is_active,
    COALESCE(c.total_contacts, 0) AS total_contacts
  FROM events e
  LEFT JOIN counts c ON c.event_id = e.id
  WHERE e.is_active = true
  ORDER BY e.start_date DESC NULLS LAST;
$function$
;

CREATE OR REPLACE FUNCTION public.api_list_subscriptions(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows JSON;
BEGIN
  SELECT json_agg(row_to_json(t)) INTO v_rows
  FROM (
    SELECT
      e.id AS event_id,
      e.name AS event_name,
      e.slug AS event_slug,
      ces.subscribed_at,
      ces.is_paused,
      ces.auto_unlock_enabled,
      ces.max_unlocks_per_event,
      ces.last_api_pulled_at,
      (SELECT COUNT(*) FROM customer_contact_access cca
        WHERE cca.user_id = p_user_id AND cca.event_id = e.id
      )::int AS unlocked_count
    FROM customer_event_subscriptions ces
    JOIN events e ON e.id = ces.event_id
    WHERE ces.user_id = p_user_id
    ORDER BY ces.subscribed_at DESC
  ) t;
  RETURN COALESCE(v_rows, '[]'::json);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.api_pull_new_contacts(p_user_id uuid, p_global_limit integer DEFAULT NULL::integer, p_max_total integer DEFAULT NULL::integer, p_dry_run boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_free INTEGER;
  v_paid INTEGER;
  v_balance INTEGER;
  v_remaining INTEGER;       -- how many we can still unlock this call
  v_total_unlocked INTEGER := 0;
  v_breakdown JSONB := '[]'::jsonb;
  v_contact_ids UUID[] := ARRAY[]::UUID[];
  v_per_event_unlocked INTEGER;
  v_per_event_cap INTEGER;
  v_per_event_to_unlock INTEGER;
  v_inserted INTEGER;
  v_deduct_free INTEGER;
  v_deduct_paid INTEGER;
  v_new_balance INTEGER;
  sub RECORD;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'User ID required');
  END IF;

  -- Compute starting balance.
  SELECT COALESCE(free_credits, 0) INTO v_free FROM user_signups WHERE user_id = p_user_id;
  v_free := COALESCE(v_free, 0);
  SELECT COALESCE(credits_balance, 0) INTO v_paid FROM customers WHERE user_id = p_user_id;
  v_paid := COALESCE(v_paid, 0);
  v_balance := v_free + v_paid;

  IF v_balance <= 0 THEN
    RETURN json_build_object(
      'success', true,
      'dry_run', p_dry_run,
      'credits_spent', 0,
      'contacts_unlocked', 0,
      'new_balance', 0,
      'breakdown', '[]'::json,
      'message', 'No credits remaining'
    );
  END IF;

  -- The cap chain: balance is the hard limit; p_global_limit and p_max_total
  -- shrink it further if either is set. NULL means "no limit beyond balance".
  v_remaining := v_balance;
  IF p_global_limit IS NOT NULL THEN
    v_remaining := LEAST(v_remaining, p_global_limit);
  END IF;
  IF p_max_total IS NOT NULL THEN
    v_remaining := LEAST(v_remaining, p_max_total);
  END IF;

  IF v_remaining <= 0 THEN
    RETURN json_build_object(
      'success', true,
      'dry_run', p_dry_run,
      'credits_spent', 0,
      'contacts_unlocked', 0,
      'new_balance', v_balance,
      'breakdown', '[]'::json,
      'message', 'Daily spend cap reached'
    );
  END IF;

  -- Walk subscriptions oldest-first so the priority order is deterministic.
  FOR sub IN
    SELECT ces.event_id, e.name AS event_name, e.slug AS event_slug,
           ces.max_unlocks_per_event
    FROM customer_event_subscriptions ces
    JOIN events e ON e.id = ces.event_id
    WHERE ces.user_id = p_user_id
      AND ces.auto_unlock_enabled = true
      AND ces.is_paused = false
    ORDER BY ces.subscribed_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;

    -- Per-event cap: max(0, cap - already_unlocked). NULL cap = no cap.
    v_per_event_cap := sub.max_unlocks_per_event;
    SELECT COUNT(*) INTO v_per_event_unlocked
    FROM customer_contact_access
    WHERE user_id = p_user_id AND event_id = sub.event_id;

    IF v_per_event_cap IS NOT NULL THEN
      v_per_event_to_unlock := GREATEST(0, v_per_event_cap - v_per_event_unlocked);
    ELSE
      v_per_event_to_unlock := v_remaining;
    END IF;

    v_per_event_to_unlock := LEAST(v_per_event_to_unlock, v_remaining);
    IF v_per_event_to_unlock <= 0 THEN
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      -- Count how many are actually available right now, but don't insert.
      SELECT COUNT(*) INTO v_inserted
      FROM (
        SELECT 1
        FROM contacts c
        JOIN contact_events ce ON ce.contact_id = c.id
        WHERE ce.event_id = sub.event_id
          AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
          AND NOT EXISTS (
            SELECT 1 FROM customer_contact_access cca
            WHERE cca.user_id = p_user_id
              AND cca.contact_id = c.id
              AND cca.event_id = sub.event_id
          )
        GROUP BY c.id
        LIMIT v_per_event_to_unlock
      ) preview;
    ELSE
      -- Real insert. Mirrors api_unlock_event_contacts ordering exactly.
      WITH inserted AS (
        INSERT INTO customer_contact_access (user_id, contact_id, event_id)
        SELECT p_user_id, contact_id, sub.event_id
        FROM (
          SELECT DISTINCT ON (c.id)
            c.id AS contact_id,
            (CASE WHEN em.email IS NOT NULL AND em.email != '' THEN 0 ELSE 1 END) AS email_priority,
            p.posted_at
          FROM contacts c
          JOIN contact_events ce ON ce.contact_id = c.id
          LEFT JOIN posts p ON p.id = ce.post_id
          LEFT JOIN contact_emails em ON em.contact_id = c.id AND em.is_primary = true
          WHERE ce.event_id = sub.event_id
            AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
            AND NOT EXISTS (
              SELECT 1 FROM customer_contact_access cca
              WHERE cca.user_id = p_user_id
                AND cca.contact_id = c.id
                AND cca.event_id = sub.event_id
            )
          ORDER BY c.id,
            (CASE WHEN em.email IS NOT NULL AND em.email != '' THEN 0 ELSE 1 END),
            p.posted_at DESC NULLS LAST
        ) deduplicated
        ORDER BY email_priority, posted_at DESC NULLS LAST
        LIMIT v_per_event_to_unlock
        ON CONFLICT (user_id, contact_id, event_id) DO NOTHING
        RETURNING contact_id
      )
      SELECT COUNT(*), COALESCE(array_agg(contact_id), ARRAY[]::UUID[])
      INTO v_inserted, v_contact_ids
      FROM inserted;
    END IF;

    IF v_inserted > 0 THEN
      v_total_unlocked := v_total_unlocked + v_inserted;
      v_remaining := v_remaining - v_inserted;
      v_breakdown := v_breakdown || jsonb_build_object(
        'event_id', sub.event_id,
        'event_slug', sub.event_slug,
        'event_name', sub.event_name,
        'unlocked', v_inserted
      );

      IF NOT p_dry_run THEN
        UPDATE customer_event_subscriptions
        SET last_api_pulled_at = now()
        WHERE user_id = p_user_id AND event_id = sub.event_id;
      END IF;
    END IF;
  END LOOP;

  -- Deduct credits unless dry-run.
  IF NOT p_dry_run AND v_total_unlocked > 0 THEN
    v_deduct_free := LEAST(v_total_unlocked, v_free);
    v_deduct_paid := v_total_unlocked - v_deduct_free;

    IF v_deduct_free > 0 THEN
      UPDATE user_signups
      SET free_credits = free_credits - v_deduct_free, updated_at = now()
      WHERE user_id = p_user_id;
    END IF;
    IF v_deduct_paid > 0 THEN
      UPDATE customers
      SET credits_balance = credits_balance - v_deduct_paid, updated_at = now()
      WHERE user_id = p_user_id;
    END IF;
  END IF;

  -- Compute new balance for the response.
  IF p_dry_run THEN
    v_new_balance := v_balance;
  ELSE
    SELECT COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0)
    INTO v_new_balance
    FROM user_signups us
    LEFT JOIN customers c ON c.user_id = us.user_id
    WHERE us.user_id = p_user_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'dry_run', p_dry_run,
    'credits_spent', CASE WHEN p_dry_run THEN 0 ELSE v_total_unlocked END,
    'contacts_unlocked', v_total_unlocked,
    'new_balance', COALESCE(v_new_balance, v_balance),
    'breakdown', v_breakdown
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.api_unlock_event_contacts(p_user_id uuid, p_event_id uuid, p_count integer, p_max_to_unlock integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_free INTEGER;
  v_paid INTEGER;
  v_total_balance INTEGER;
  v_available_count INTEGER;
  v_actual_count INTEGER;
  v_actual_inserted INTEGER;
  v_deduct_free INTEGER;
  v_deduct_paid INTEGER;
  v_new_balance INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'User ID required');
  END IF;
  IF p_count <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'Invalid count');
  END IF;

  SELECT free_credits INTO v_free FROM user_signups WHERE user_id = p_user_id;
  IF v_free IS NULL THEN
    INSERT INTO user_signups (user_id, free_credits) VALUES (p_user_id, 20)
    ON CONFLICT (user_id) DO NOTHING;
    v_free := 20;
  END IF;
  SELECT credits_balance INTO v_paid FROM customers WHERE user_id = p_user_id;
  v_paid := COALESCE(v_paid, 0);
  v_total_balance := v_free + v_paid;

  IF v_total_balance <= 0 THEN
    RETURN json_build_object(
      'success', false,
      'message', 'No credits remaining',
      'current_balance', 0
    );
  END IF;

  -- Settled rows only (3+ hours since last update) — must match unlock_event_contacts.
  SELECT COUNT(*) INTO v_available_count
  FROM contacts c
  JOIN contact_events ce ON ce.contact_id = c.id
  WHERE ce.event_id = p_event_id
    AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
    AND NOT EXISTS (
      SELECT 1 FROM customer_contact_access cca
      WHERE cca.user_id = p_user_id
        AND cca.contact_id = c.id
        AND cca.event_id = p_event_id
    );

  IF v_available_count = 0 THEN
    RETURN json_build_object('success', false, 'message', 'No more contacts to unlock');
  END IF;

  v_actual_count := LEAST(p_count, v_available_count, v_total_balance);
  IF p_max_to_unlock IS NOT NULL THEN
    v_actual_count := LEAST(v_actual_count, p_max_to_unlock);
  END IF;

  IF v_actual_count <= 0 THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Daily spend cap reached',
      'credits_spent', 0,
      'new_balance', v_total_balance
    );
  END IF;

  -- Auto-subscribe (idempotent).
  INSERT INTO customer_event_subscriptions (user_id, event_id)
  VALUES (p_user_id, p_event_id)
  ON CONFLICT (user_id, event_id) DO NOTHING;

  -- Insert best-available contacts (email-verified first, then most recent post).
  INSERT INTO customer_contact_access (user_id, contact_id, event_id)
  SELECT p_user_id, contact_id, p_event_id
  FROM (
    SELECT DISTINCT ON (c.id)
      c.id AS contact_id,
      (CASE WHEN em.email IS NOT NULL AND em.email != '' THEN 0 ELSE 1 END) AS email_priority,
      p.posted_at
    FROM contacts c
    JOIN contact_events ce ON ce.contact_id = c.id
    LEFT JOIN posts p ON p.id = ce.post_id
    LEFT JOIN contact_emails em ON em.contact_id = c.id AND em.is_primary = true
    WHERE ce.event_id = p_event_id
      AND COALESCE(c.updated_at, c.created_at) <= NOW() - INTERVAL '3 hours'
      AND NOT EXISTS (
        SELECT 1 FROM customer_contact_access cca
        WHERE cca.user_id = p_user_id
          AND cca.contact_id = c.id
          AND cca.event_id = p_event_id
      )
    ORDER BY c.id,
      (CASE WHEN em.email IS NOT NULL AND em.email != '' THEN 0 ELSE 1 END),
      p.posted_at DESC NULLS LAST
  ) deduplicated
  ORDER BY email_priority, posted_at DESC NULLS LAST
  LIMIT v_actual_count
  ON CONFLICT (user_id, contact_id, event_id) DO NOTHING;

  GET DIAGNOSTICS v_actual_inserted = ROW_COUNT;

  v_deduct_free := LEAST(v_actual_inserted, v_free);
  v_deduct_paid := v_actual_inserted - v_deduct_free;

  IF v_deduct_free > 0 THEN
    UPDATE user_signups
    SET free_credits = free_credits - v_deduct_free, updated_at = now()
    WHERE user_id = p_user_id;
  END IF;
  IF v_deduct_paid > 0 THEN
    UPDATE customers
    SET credits_balance = credits_balance - v_deduct_paid, updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  v_new_balance := api_get_user_credits(p_user_id);

  RETURN json_build_object(
    'success', true,
    'message', v_actual_inserted || ' contacts unlocked',
    'credits_spent', v_actual_inserted,
    'new_balance', v_new_balance,
    'contacts_unlocked', v_actual_inserted
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.api_upsert_subscription(p_user_id uuid, p_event_id uuid, p_auto_unlock_enabled boolean DEFAULT NULL::boolean, p_max_unlocks_per_event integer DEFAULT NULL::integer, p_is_paused boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row customer_event_subscriptions%ROWTYPE;
BEGIN
  IF p_max_unlocks_per_event IS NOT NULL AND p_max_unlocks_per_event < 0 THEN
    RETURN json_build_object('success', false, 'message', 'max_unlocks_per_event must be >= 0');
  END IF;

  INSERT INTO customer_event_subscriptions (
    user_id, event_id, auto_unlock_enabled, max_unlocks_per_event, is_paused
  )
  VALUES (
    p_user_id, p_event_id,
    COALESCE(p_auto_unlock_enabled, false),
    p_max_unlocks_per_event,
    COALESCE(p_is_paused, false)
  )
  ON CONFLICT (user_id, event_id) DO UPDATE SET
    auto_unlock_enabled = COALESCE(p_auto_unlock_enabled, customer_event_subscriptions.auto_unlock_enabled),
    max_unlocks_per_event = COALESCE(p_max_unlocks_per_event, customer_event_subscriptions.max_unlocks_per_event),
    is_paused = COALESCE(p_is_paused, customer_event_subscriptions.is_paused)
  RETURNING * INTO v_row;

  RETURN json_build_object(
    'success', true,
    'subscription', json_build_object(
      'event_id', v_row.event_id,
      'auto_unlock_enabled', v_row.auto_unlock_enabled,
      'max_unlocks_per_event', v_row.max_unlocks_per_event,
      'is_paused', v_row.is_paused,
      'last_api_pulled_at', v_row.last_api_pulled_at,
      'subscribed_at', v_row.subscribed_at
    )
  );
END;
$function$
;
