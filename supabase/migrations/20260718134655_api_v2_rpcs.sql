-- Public API v2 launch (2026-07-18): filter-aware, 2-tier-priced api_* RPCs.
--
-- The April 2026 api_* RPCs predate ICP filtering and 2-tier pricing: flat 1cr,
-- no filters, no unlock_batches, and they returned emails without the
-- email_unlocked gate. This migration replaces them with p_user_id ports of the
-- live dashboard RPCs (unlock_event_contacts / reveal_event_emails /
-- get_event_filter_facets / get_subscribed_event_contacts, latest defs
-- 20260717142200, 20260621043449, 20260712111019, 20260627213907) so API and
-- dashboard share one pricing model:
--   unfiltered unlock (has_email alone counts as unfiltered) = 1cr per contact,
--     verified emails included free;
--   filtered unlock = 1cr per identity, +1cr per valid email either bundled in
--     the same call (p_include_emails) or revealed later.
-- Every function is SECURITY DEFINER and invoked with the service role after
-- API-key auth; tenant isolation is the WHERE user_id = p_user_id clause.
-- pg_advisory_xact_lock serializes all money mutations per user so concurrent
-- unlock / reveal / auto-pull cannot double-spend the free-then-paid deduction.
--
-- Also introduces auto-pull rules (customer_event_subscriptions rows extended in
-- 20260718133835): api_run_pull_rules replaces api_pull_new_contacts and routes
-- every unlock through api_unlock_event_contacts, so there is exactly one money
-- path. The old 3h settle filter is gone: API now matches the dashboard unlock
-- path (no settle filter), and status counts use the same valid-email
-- definition as facets and unlock.

-- ============================================================
-- 1) Unlock (the money path)
-- ============================================================

DROP FUNCTION IF EXISTS public.api_unlock_event_contacts(uuid, uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.api_unlock_event_contacts(
  p_user_id uuid,
  p_event_id uuid,
  p_count integer,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_include_emails boolean DEFAULT true,
  p_max_credits integer DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_free INTEGER;
  v_paid INTEGER;
  v_total_balance INTEGER;
  v_budget INTEGER;
  v_no_icp BOOLEAN;
  v_charge_emails BOOLEAN;
  v_batch_id UUID;
  v_created_batch BOOLEAN := false;
  v_candidates INTEGER;
  v_actual_inserted INTEGER := 0;
  v_emails_included INTEGER := 0;
  v_emails_revealed INTEGER := 0;
  v_credits_spent INTEGER := 0;
  v_deduct_free INTEGER;
  v_deduct_paid INTEGER;
  v_new_balance INTEGER;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'User ID required');
  END IF;
  IF p_count IS NULL OR p_count <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'Invalid count');
  END IF;

  -- One money mutation at a time per user (unlock / reveal / auto-pull drain).
  PERFORM pg_advisory_xact_lock(hashtext('wg_credits:' || p_user_id::text));

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
    RETURN json_build_object('success', false, 'message', 'No credits remaining', 'current_balance', 0);
  END IF;

  v_budget := v_total_balance;
  IF p_max_credits IS NOT NULL THEN
    v_budget := LEAST(v_budget, p_max_credits);
  END IF;
  IF v_budget <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'Daily spend cap reached',
      'credits_spent', 0, 'new_balance', v_total_balance);
  END IF;

  -- has_email alone is not an ICP filter (the user is filtering FOR emails).
  v_no_icp := (p_filters IS NULL OR (p_filters - 'has_email') = '{}'::jsonb);
  v_charge_emails := (NOT v_no_icp) AND p_include_emails;

  -- Candidates materialized once: selection, budget math and has_more all come
  -- from this single scan. Per-row cost is 1 credit for the identity plus 1 when
  -- this call also buys the email (filtered + include_emails + has a valid email).
  -- DROP first: api_run_pull_rules calls this function in a loop inside one
  -- transaction, so ON COMMIT DROP alone would collide on the second event.
  DROP TABLE IF EXISTS _api_unlock_cand;
  CREATE TEMPORARY TABLE _api_unlock_cand ON COMMIT DROP AS
  SELECT f.contact_id, f.has_email,
         row_number() OVER w AS rn,
         SUM(1 + CASE WHEN v_charge_emails AND f.has_email THEN 1 ELSE 0 END) OVER w AS cum_cost
  FROM public.event_filtered_contact_ids(p_event_id, COALESCE(p_filters, '{}'::jsonb)) f
  WHERE NOT EXISTS (
    SELECT 1 FROM customer_contact_access cca
    WHERE cca.user_id = p_user_id AND cca.contact_id = f.contact_id AND cca.event_id = p_event_id
  )
  WINDOW w AS (
    ORDER BY (CASE WHEN f.has_email THEN 0 ELSE 1 END), f.created_at DESC NULLS LAST, f.contact_id
    ROWS UNBOUNDED PRECEDING
  );

  SELECT count(*) INTO v_candidates FROM _api_unlock_cand;
  IF v_candidates = 0 THEN
    RETURN json_build_object('success', false, 'message', 'No more contacts to unlock');
  END IF;

  -- Keep dashboard My Events in sync (idempotent; does NOT enable auto-pull).
  INSERT INTO customer_event_subscriptions (user_id, event_id)
  VALUES (p_user_id, p_event_id)
  ON CONFLICT (user_id, event_id) DO NOTHING;

  -- Continue the caller's batch only if it really is theirs, for this event.
  IF p_batch_id IS NOT NULL THEN
    SELECT id INTO v_batch_id FROM unlock_batches
    WHERE id = p_batch_id AND user_id = p_user_id AND event_id = p_event_id;
  END IF;
  IF v_batch_id IS NULL THEN
    INSERT INTO unlock_batches (user_id, event_id, filters, requested_count)
    VALUES (p_user_id, p_event_id, COALESCE(p_filters, '{}'::jsonb), p_count)
    RETURNING id INTO v_batch_id;
    v_created_batch := true;
  END IF;

  INSERT INTO customer_contact_access (user_id, contact_id, event_id, batch_id)
  SELECT p_user_id, cand.contact_id, p_event_id, v_batch_id
  FROM _api_unlock_cand cand
  WHERE cand.rn <= p_count AND cand.cum_cost <= v_budget
  ORDER BY cand.rn
  ON CONFLICT (user_id, contact_id, event_id) DO NOTHING;

  GET DIAGNOSTICS v_actual_inserted = ROW_COUNT;

  IF v_actual_inserted = 0 THEN
    IF v_created_batch THEN
      DELETE FROM unlock_batches WHERE id = v_batch_id;
    END IF;
    -- Candidates exist but none fit the credit budget (e.g. budget 1, first row costs 2).
    RETURN json_build_object('success', false, 'message', 'Credit budget too small for any contact',
      'has_more', true, 'new_balance', v_total_balance);
  END IF;

  UPDATE unlock_batches
  SET unlocked_count = unlocked_count + v_actual_inserted
  WHERE id = v_batch_id;

  v_credits_spent := v_actual_inserted;

  IF v_no_icp THEN
    -- Emails included free on any unlock with no ICP filter (partial slices too).
    -- email_charged_at stays NULL: these were not individually charged.
    UPDATE customer_contact_access cca
    SET email_unlocked = true
    WHERE cca.user_id = p_user_id AND cca.event_id = p_event_id
      AND cca.batch_id = v_batch_id AND cca.email_unlocked = false;
    GET DIAGNOSTICS v_emails_included = ROW_COUNT;
  ELSIF p_include_emails THEN
    -- Bundled reveal: +1cr per contact in this batch that has a valid email.
    UPDATE customer_contact_access cca
    SET email_unlocked = true, email_charged_at = now()
    WHERE cca.user_id = p_user_id AND cca.event_id = p_event_id
      AND cca.batch_id = v_batch_id AND cca.email_unlocked = false
      AND EXISTS (
        SELECT 1 FROM contact_emails em
        WHERE em.contact_id = cca.contact_id AND em.status = 'valid'
          AND em.email IS NOT NULL AND em.email <> ''
      );
    GET DIAGNOSTICS v_emails_revealed = ROW_COUNT;
    v_credits_spent := v_credits_spent + v_emails_revealed;
  END IF;

  v_deduct_free := LEAST(v_credits_spent, v_free);
  v_deduct_paid := v_credits_spent - v_deduct_free;
  IF v_deduct_free > 0 THEN
    UPDATE user_signups SET free_credits = free_credits - v_deduct_free, updated_at = now()
    WHERE user_id = p_user_id;
  END IF;
  IF v_deduct_paid > 0 THEN
    UPDATE customers SET credits_balance = credits_balance - v_deduct_paid, updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  SELECT COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0)
  INTO v_new_balance
  FROM user_signups us LEFT JOIN customers c ON c.user_id = us.user_id
  WHERE us.user_id = p_user_id;

  RETURN json_build_object(
    'success', true,
    'message', v_actual_inserted || ' contacts unlocked',
    'contacts_unlocked', v_actual_inserted,
    'emails_included', v_emails_included,
    'emails_revealed', v_emails_revealed,
    'credits_spent', v_credits_spent,
    'new_balance', v_new_balance,
    'batch_id', v_batch_id,
    'no_icp', v_no_icp,
    'has_more', (v_candidates - v_actual_inserted) > 0
  );
END;
$function$;

-- ============================================================
-- 2) Reveal emails (the second tier, standalone)
-- ============================================================

CREATE OR REPLACE FUNCTION public.api_reveal_event_emails(
  p_user_id uuid,
  p_event_id uuid,
  p_contact_ids uuid[] DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_max_credits integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_free int;
  v_paid int;
  v_bal int;
  v_target int;
  v_revealed int;
  v_df int;
  v_dp int;
  v_newbal int;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'User ID required');
  END IF;
  IF p_max_credits IS NOT NULL AND p_max_credits <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'Daily spend cap reached');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wg_credits:' || p_user_id::text));

  SELECT COALESCE(free_credits, 0) INTO v_free FROM user_signups WHERE user_id = p_user_id;
  v_free := COALESCE(v_free, 0);
  SELECT COALESCE(credits_balance, 0) INTO v_paid FROM customers WHERE user_id = p_user_id;
  v_paid := COALESCE(v_paid, 0);
  v_bal := v_free + v_paid;

  DROP TABLE IF EXISTS _api_to_reveal;
  CREATE TEMPORARY TABLE _api_to_reveal ON COMMIT DROP AS
  SELECT cca.contact_id
  FROM customer_contact_access cca
  WHERE cca.user_id = p_user_id
    AND cca.event_id = p_event_id
    AND cca.email_unlocked = false
    AND (p_contact_ids IS NULL OR cca.contact_id = ANY(p_contact_ids))
    AND EXISTS (SELECT 1 FROM contact_emails em
                WHERE em.contact_id = cca.contact_id AND em.status = 'valid'
                  AND em.email IS NOT NULL AND em.email <> '')
    AND (COALESCE(p_filters, '{}'::jsonb) = '{}'::jsonb
         OR cca.contact_id IN (SELECT f.contact_id FROM public.event_filtered_contact_ids(p_event_id, p_filters) f));

  SELECT count(*) INTO v_target FROM _api_to_reveal;
  IF v_target = 0 THEN
    RETURN json_build_object('success', false, 'message', 'No emails to reveal');
  END IF;
  IF v_bal <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'No credits remaining');
  END IF;

  v_target := LEAST(v_target, v_bal, COALESCE(p_max_credits, v_target));

  DROP TABLE IF EXISTS _api_rev;
  CREATE TEMPORARY TABLE _api_rev ON COMMIT DROP AS
  SELECT contact_id FROM _api_to_reveal ORDER BY contact_id LIMIT v_target;

  UPDATE customer_contact_access cca
  SET email_unlocked = true, email_charged_at = now()
  WHERE cca.user_id = p_user_id AND cca.event_id = p_event_id
    AND cca.contact_id IN (SELECT contact_id FROM _api_rev);
  GET DIAGNOSTICS v_revealed = ROW_COUNT;

  v_df := LEAST(v_revealed, v_free);
  v_dp := v_revealed - v_df;
  IF v_df > 0 THEN
    UPDATE user_signups SET free_credits = free_credits - v_df, updated_at = now() WHERE user_id = p_user_id;
  END IF;
  IF v_dp > 0 THEN
    UPDATE customers SET credits_balance = credits_balance - v_dp, updated_at = now() WHERE user_id = p_user_id;
  END IF;

  SELECT COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0) INTO v_newbal
  FROM user_signups us LEFT JOIN customers c ON c.user_id = us.user_id
  WHERE us.user_id = p_user_id;

  RETURN json_build_object(
    'success', true,
    'emails_revealed', v_revealed,
    'credits_spent', v_revealed,
    'new_balance', v_newbal,
    'revealed', (
      SELECT COALESCE(json_agg(json_build_object(
        'contact_id', r.contact_id,
        'email', (SELECT e.email FROM contact_emails e
                  WHERE e.contact_id = r.contact_id AND e.status = 'valid'
                  ORDER BY e.is_primary DESC NULLS LAST LIMIT 1)
      )), '[]'::json)
      FROM _api_rev r
    )
  );
END;
$function$;

-- ============================================================
-- 3) Facets (per-user owned count)
-- ============================================================

CREATE OR REPLACE FUNCTION public.api_get_event_filter_facets(p_user_id uuid, p_event_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
  with m as (select * from public.event_filtered_contact_ids(p_event_id, p_filters))
  select json_build_object(
    'matched',    (select count(*) from m),
    'with_email', (select count(*) from m where has_email),
    'owned',      (select count(*)
                   from m
                   join customer_contact_access cca
                     on cca.contact_id = m.contact_id
                    and cca.event_id = p_event_id
                    and cca.user_id = p_user_id),
    'by_seniority', (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select case when seniority is null or seniority = 'Other' then 'Other / Unknown' else seniority end k,
                                  count(*) n from m group by 1) s),
    'by_function',  (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select coalesce(func,'Unknown') k, count(*) n from m group by 1) s),
    'by_role',      (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select role k, count(*) n from m group by 1) s),
    'by_industry',  (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select case when industry is null or industry = 'Other / Unknown' then 'Other / Unknown' else industry end k,
                                  count(*) n from m group by 1 order by 2 desc limit 30) s),
    'by_size',      (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select coalesce(sizeb,'Unknown') k, count(*) n from m group by 1) s),
    'by_country',   (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select coalesce(country,'Unknown') k, count(*) n from m group by 1 order by 2 desc limit 15) s),
    'top_companies',(select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select company_name k, count(*) n from m
                           where company_name is not null
                             and lower(trim(company_name)) not in
                               ('results','self-employed','self employed','freelance','freelancer',
                                'freelancing','independent','various','unknown','n/a','none','-','.')
                           group by 1 order by 2 desc limit 15) s)
  );
$function$;

-- ============================================================
-- 4) Unlocked contacts, per event (email gated on email_unlocked)
-- ============================================================

DROP FUNCTION IF EXISTS public.api_get_unlocked_contacts(uuid, uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.api_get_unlocked_contacts(
  p_user_id uuid,
  p_event_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_sort_key text DEFAULT 'unlocked_at',
  p_sort_dir text DEFAULT 'desc'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_asc boolean := lower(COALESCE(p_sort_dir, 'desc')) = 'asc';
  v_key text := COALESCE(p_sort_key, 'unlocked_at');
  v_filtered boolean := COALESCE(p_filters, '{}'::jsonb) <> '{}'::jsonb;
  v_total integer;
  v_rows jsonb;
BEGIN
  IF v_key NOT IN ('unlocked_at', 'full_name', 'current_title', 'company_name', 'post_date', 'email') THEN
    v_key := 'unlocked_at';
  END IF;

  -- ICP filters restrict through the one shared helper instead of duplicating
  -- its predicates; materialized once so count + page reuse the same scan.
  DROP TABLE IF EXISTS _api_matched;
  CREATE TEMPORARY TABLE _api_matched (contact_id uuid PRIMARY KEY) ON COMMIT DROP;
  IF v_filtered THEN
    INSERT INTO _api_matched
    SELECT f.contact_id FROM public.event_filtered_contact_ids(p_event_id, p_filters) f;
  END IF;

  SELECT count(*) INTO v_total
  FROM customer_contact_access cca
  WHERE cca.user_id = p_user_id AND cca.event_id = p_event_id
    AND (NOT v_filtered OR EXISTS (SELECT 1 FROM _api_matched m WHERE m.contact_id = cca.contact_id));

  WITH scoped AS (
    SELECT cca.contact_id, cca.charged_at, cca.email_unlocked, cca.batch_id,
      CASE WHEN v_key = 'unlocked_at' THEN cca.charged_at
           WHEN v_key = 'post_date' THEN (
             SELECT max(p2.posted_at)
             FROM contact_events ce2 JOIN posts p2 ON p2.id = ce2.post_id
             WHERE ce2.contact_id = cca.contact_id AND ce2.event_id = p_event_id)
      END AS sort_ts,
      CASE v_key
        WHEN 'full_name' THEN lower(c.full_name)
        WHEN 'current_title' THEN lower(c.current_title)
        WHEN 'company_name' THEN lower(co.name)
        WHEN 'email' THEN lower((
          SELECT e.email FROM contact_emails e
          WHERE e.contact_id = cca.contact_id AND e.status = 'valid'
          ORDER BY e.is_primary DESC NULLS LAST LIMIT 1))
      END AS sort_txt
    FROM customer_contact_access cca
    JOIN contacts c ON c.id = cca.contact_id
    LEFT JOIN companies co ON co.id = c.current_company_id
    WHERE cca.user_id = p_user_id AND cca.event_id = p_event_id
      AND (NOT v_filtered OR EXISTS (SELECT 1 FROM _api_matched m WHERE m.contact_id = cca.contact_id))
  ),
  page AS (
    SELECT s.*,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_asc THEN s.sort_ts END ASC NULLS LAST,
          CASE WHEN NOT v_asc THEN s.sort_ts END DESC NULLS LAST,
          CASE WHEN v_asc THEN s.sort_txt END ASC NULLS LAST,
          CASE WHEN NOT v_asc THEN s.sort_txt END DESC NULLS LAST,
          s.charged_at DESC
      ) AS rn
    FROM scoped s
    ORDER BY rn
    LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_agg(to_jsonb(t) - 'rn' ORDER BY t.rn) INTO v_rows
  FROM (
    SELECT page.rn,
      c.id AS contact_id, c.full_name, c.first_name, c.last_name, c.current_title, c.headline,
      c.linkedin_url AS contact_linkedin_url, c.city, c.country,
      CASE WHEN page.email_unlocked THEN cem.email END AS email,
      CASE WHEN page.email_unlocked THEN cem.status END AS email_status,
      CASE WHEN page.email_unlocked THEN cem.provider END AS email_provider,
      (cem.email IS NOT NULL) AS has_email,
      page.email_unlocked,
      co.name AS company_name, co.linkedin_url AS company_linkedin_url, co.domain AS company_domain,
      co.website AS company_website, co.industry AS company_industry, co.size_range AS company_size,
      co.headquarters AS company_headquarters, co.founded_year AS company_founded_year,
      co.size_bucket AS company_size_bucket, co.industry_bucket AS company_industry_bucket,
      pe.post_url, pe.post_date, pe.source,
      CASE
        WHEN COALESCE(cer.role, 'attendee') IN ('organizer', 'sponsor', 'exhibitor') THEN cer.role
        WHEN EXISTS (SELECT 1 FROM contact_events cep
                     WHERE cep.contact_id = c.id AND cep.event_id = p_event_id
                       AND (cep.is_speaker = true OR cep.source_type IN ('post_author', 'mentioned'))) THEN 'attendee'
        ELSE 'expected_attendee'
      END AS event_role,
      EXISTS (SELECT 1 FROM contact_events ce3
              WHERE ce3.contact_id = c.id AND ce3.event_id = p_event_id AND ce3.is_speaker = true) AS is_speaker,
      page.charged_at AS unlocked_at,
      page.batch_id
    FROM page
    JOIN contacts c ON c.id = page.contact_id
    LEFT JOIN LATERAL (
      SELECT e.email, e.status, e.provider
      FROM contact_emails e
      WHERE e.contact_id = c.id AND e.status = 'valid'
      ORDER BY e.is_primary DESC NULLS LAST
      LIMIT 1
    ) cem ON true
    LEFT JOIN companies co ON c.current_company_id = co.id
    LEFT JOIN company_event_roles cer ON cer.event_id = p_event_id AND cer.company_id = c.current_company_id
    LEFT JOIN LATERAL (
      SELECT p.post_url, p.posted_at AS post_date, ce.source_type AS source
      FROM contact_events ce LEFT JOIN posts p ON p.id = ce.post_id
      WHERE ce.contact_id = c.id AND ce.event_id = p_event_id
      ORDER BY p.posted_at DESC NULLS LAST
      LIMIT 1
    ) pe ON true
  ) t;

  RETURN json_build_object(
    'contacts', COALESCE(v_rows, '[]'::jsonb),
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'has_more', (p_offset + p_limit) < v_total
  );
END;
$function$;

-- ============================================================
-- 5) Unlocked contacts, all events (incremental sync feed)
-- ============================================================

DROP FUNCTION IF EXISTS public.api_get_all_unlocked_contacts(uuid, integer, integer, timestamp with time zone);

CREATE OR REPLACE FUNCTION public.api_get_all_unlocked_contacts(
  p_user_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_since timestamp with time zone DEFAULT NULL,
  p_event_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  -- With p_since the feed pages oldest-first so the caller can walk forward and
  -- persist the returned watermark; without it newest-first for browsing.
  v_asc boolean := p_since IS NOT NULL;
  v_total integer;
  v_rows jsonb;
  v_watermark timestamptz;
BEGIN
  SELECT count(*) INTO v_total
  FROM customer_contact_access cca
  WHERE cca.user_id = p_user_id
    AND (p_since IS NULL OR cca.charged_at > p_since)
    AND (p_event_id IS NULL OR cca.event_id = p_event_id);

  WITH page AS (
    SELECT cca.contact_id, cca.event_id, cca.charged_at, cca.email_unlocked, cca.batch_id,
      row_number() OVER (
        ORDER BY
          CASE WHEN v_asc THEN cca.charged_at END ASC,
          CASE WHEN NOT v_asc THEN cca.charged_at END DESC,
          cca.id
      ) AS rn
    FROM customer_contact_access cca
    WHERE cca.user_id = p_user_id
      AND (p_since IS NULL OR cca.charged_at > p_since)
      AND (p_event_id IS NULL OR cca.event_id = p_event_id)
    ORDER BY rn
    LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_agg(to_jsonb(t) - 'rn' ORDER BY t.rn), max(t.unlocked_at)
  INTO v_rows, v_watermark
  FROM (
    SELECT page.rn,
      page.event_id, e.name AS event_name, e.slug AS event_slug,
      c.id AS contact_id, c.full_name, c.first_name, c.last_name, c.current_title, c.headline,
      c.linkedin_url AS contact_linkedin_url, c.city, c.country,
      CASE WHEN page.email_unlocked THEN cem.email END AS email,
      CASE WHEN page.email_unlocked THEN cem.status END AS email_status,
      CASE WHEN page.email_unlocked THEN cem.provider END AS email_provider,
      (cem.email IS NOT NULL) AS has_email,
      page.email_unlocked,
      co.name AS company_name, co.linkedin_url AS company_linkedin_url, co.domain AS company_domain,
      co.website AS company_website, co.industry AS company_industry, co.size_range AS company_size,
      co.headquarters AS company_headquarters, co.founded_year AS company_founded_year,
      co.size_bucket AS company_size_bucket, co.industry_bucket AS company_industry_bucket,
      pe.post_url, pe.post_date, pe.source,
      CASE
        WHEN COALESCE(cer.role, 'attendee') IN ('organizer', 'sponsor', 'exhibitor') THEN cer.role
        WHEN EXISTS (SELECT 1 FROM contact_events cep
                     WHERE cep.contact_id = c.id AND cep.event_id = page.event_id
                       AND (cep.is_speaker = true OR cep.source_type IN ('post_author', 'mentioned'))) THEN 'attendee'
        ELSE 'expected_attendee'
      END AS event_role,
      EXISTS (SELECT 1 FROM contact_events ce3
              WHERE ce3.contact_id = c.id AND ce3.event_id = page.event_id AND ce3.is_speaker = true) AS is_speaker,
      page.charged_at AS unlocked_at,
      page.batch_id
    FROM page
    JOIN events e ON e.id = page.event_id
    JOIN contacts c ON c.id = page.contact_id
    LEFT JOIN LATERAL (
      SELECT em.email, em.status, em.provider
      FROM contact_emails em
      WHERE em.contact_id = c.id AND em.status = 'valid'
      ORDER BY em.is_primary DESC NULLS LAST
      LIMIT 1
    ) cem ON true
    LEFT JOIN companies co ON c.current_company_id = co.id
    LEFT JOIN company_event_roles cer ON cer.event_id = page.event_id AND cer.company_id = c.current_company_id
    LEFT JOIN LATERAL (
      SELECT p.post_url, p.posted_at AS post_date, ce.source_type AS source
      FROM contact_events ce LEFT JOIN posts p ON p.id = ce.post_id
      WHERE ce.contact_id = c.id AND ce.event_id = page.event_id
      ORDER BY p.posted_at DESC NULLS LAST
      LIMIT 1
    ) pe ON true
  ) t;

  RETURN json_build_object(
    'contacts', COALESCE(v_rows, '[]'::jsonb),
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'since', p_since,
    'watermark', v_watermark,
    'has_more', (p_offset + p_limit) < v_total
  );
END;
$function$;

-- ============================================================
-- 6) Auto-pull rules (replaces the subscriptions concept in the API)
-- ============================================================

DROP FUNCTION IF EXISTS public.api_pull_new_contacts(uuid, integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.api_run_pull_rules(
  p_user_id uuid,
  p_max_credits integer DEFAULT NULL,
  p_dry_run boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_free int;
  v_paid int;
  v_balance int;
  v_remaining int;
  v_today date := (now() AT TIME ZONE 'utc')::date;
  v_total_unlocked int := 0;
  v_total_emails int := 0;
  v_total_spent int := 0;
  v_est_total int := 0;
  v_breakdown jsonb := '[]'::jsonb;
  sub RECORD;
  v_owned int;
  v_spent_today int;
  v_rule_budget int;
  v_count_cap int;
  v_avail int;
  v_avail_email int;
  v_no_icp boolean;
  v_est int;
  v_result json;
  v_spent int;
  v_unlocked int;
  v_emails int;
  v_new_balance int;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'User ID required');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wg_credits:' || p_user_id::text));

  SELECT COALESCE(free_credits, 0) INTO v_free FROM user_signups WHERE user_id = p_user_id;
  v_free := COALESCE(v_free, 0);
  SELECT COALESCE(credits_balance, 0) INTO v_paid FROM customers WHERE user_id = p_user_id;
  v_paid := COALESCE(v_paid, 0);
  v_balance := v_free + v_paid;

  IF v_balance <= 0 THEN
    RETURN json_build_object('success', true, 'dry_run', p_dry_run, 'credits_spent', 0,
      'contacts_unlocked', 0, 'emails_unlocked', 0, 'new_balance', 0,
      'breakdown', '[]'::json, 'message', 'No credits remaining');
  END IF;

  v_remaining := v_balance;
  IF p_max_credits IS NOT NULL THEN
    v_remaining := LEAST(v_remaining, p_max_credits);
  END IF;
  IF v_remaining <= 0 THEN
    RETURN json_build_object('success', true, 'dry_run', p_dry_run, 'credits_spent', 0,
      'contacts_unlocked', 0, 'emails_unlocked', 0, 'new_balance', v_balance,
      'breakdown', '[]'::json, 'message', 'Daily spend cap reached');
  END IF;

  -- Oldest rule first: deterministic priority when balance is short.
  FOR sub IN
    SELECT ces.*, e.name AS event_name, e.slug AS event_slug
    FROM customer_event_subscriptions ces
    JOIN events e ON e.id = ces.event_id
    WHERE ces.user_id = p_user_id
      AND ces.auto_unlock_enabled = true
      AND ces.is_paused = false
    ORDER BY ces.subscribed_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_spent_today := CASE WHEN sub.pull_spend_day = v_today THEN sub.pull_credits_spent_today ELSE 0 END;

    v_rule_budget := v_remaining;
    IF sub.max_credits_per_day IS NOT NULL THEN
      v_rule_budget := LEAST(v_rule_budget, GREATEST(0, sub.max_credits_per_day - v_spent_today));
    END IF;

    -- max_unlocks_per_event is a lifetime cap in CONTACTS.
    v_count_cap := NULL;
    IF sub.max_unlocks_per_event IS NOT NULL THEN
      SELECT count(*) INTO v_owned FROM customer_contact_access
      WHERE user_id = p_user_id AND event_id = sub.event_id;
      v_count_cap := GREATEST(0, sub.max_unlocks_per_event - v_owned);
    END IF;

    IF v_rule_budget <= 0 OR COALESCE(v_count_cap, 1) = 0 THEN
      CONTINUE;
    END IF;

    IF p_dry_run THEN
      SELECT count(*), count(*) FILTER (WHERE f.has_email) INTO v_avail, v_avail_email
      FROM public.event_filtered_contact_ids(sub.event_id, sub.pull_filters) f
      WHERE NOT EXISTS (
        SELECT 1 FROM customer_contact_access cca
        WHERE cca.user_id = p_user_id AND cca.contact_id = f.contact_id AND cca.event_id = sub.event_id
      );

      IF v_count_cap IS NOT NULL AND v_count_cap < v_avail THEN
        v_avail := v_count_cap;
        v_avail_email := LEAST(v_avail_email, v_count_cap);
      END IF;
      v_no_icp := (sub.pull_filters - 'has_email') = '{}'::jsonb;
      v_est := v_avail + CASE WHEN (NOT v_no_icp) AND sub.pull_include_emails THEN v_avail_email ELSE 0 END;
      v_est := LEAST(v_est, v_rule_budget);

      IF v_avail > 0 THEN
        v_breakdown := v_breakdown || jsonb_build_object(
          'event_id', sub.event_id, 'event_slug', sub.event_slug, 'event_name', sub.event_name,
          'available_contacts', v_avail, 'available_with_email', v_avail_email,
          'estimated_credits', v_est);
        v_est_total := v_est_total + v_est;
        v_remaining := v_remaining - v_est;
      END IF;
    ELSE
      -- One shared money path: the unlock RPC does pricing, dedupe and deduction.
      -- The advisory xact lock is already held by this transaction, so the
      -- nested acquire returns immediately.
      v_result := public.api_unlock_event_contacts(
        p_user_id,
        sub.event_id,
        COALESCE(v_count_cap, v_rule_budget),
        sub.pull_filters,
        sub.pull_include_emails,
        v_rule_budget,
        NULL);

      v_spent := COALESCE((v_result->>'credits_spent')::int, 0);
      v_unlocked := COALESCE((v_result->>'contacts_unlocked')::int, 0);
      v_emails := COALESCE((v_result->>'emails_revealed')::int, 0) + COALESCE((v_result->>'emails_included')::int, 0);

      UPDATE customer_event_subscriptions
      SET last_api_pulled_at = now(),
          pull_credits_spent_today = v_spent_today + v_spent,
          pull_spend_day = v_today
      WHERE user_id = p_user_id AND event_id = sub.event_id;

      IF v_unlocked > 0 THEN
        v_total_unlocked := v_total_unlocked + v_unlocked;
        v_total_emails := v_total_emails + v_emails;
        v_total_spent := v_total_spent + v_spent;
        v_remaining := v_remaining - v_spent;
        v_breakdown := v_breakdown || jsonb_build_object(
          'event_id', sub.event_id, 'event_slug', sub.event_slug, 'event_name', sub.event_name,
          'contacts_unlocked', v_unlocked, 'emails_unlocked', v_emails,
          'credits_spent', v_spent,
          'has_more', COALESCE((v_result->>'has_more')::boolean, false));
      END IF;
    END IF;
  END LOOP;

  IF p_dry_run THEN
    v_new_balance := v_balance;
  ELSE
    SELECT COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0) INTO v_new_balance
    FROM user_signups us LEFT JOIN customers c ON c.user_id = us.user_id
    WHERE us.user_id = p_user_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'dry_run', p_dry_run,
    'credits_spent', v_total_spent,
    'estimated_credits', CASE WHEN p_dry_run THEN v_est_total ELSE NULL END,
    'contacts_unlocked', v_total_unlocked,
    'emails_unlocked', v_total_emails,
    'new_balance', COALESCE(v_new_balance, v_balance),
    'breakdown', v_breakdown
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.api_list_pull_rules(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC) INTO v_rows
  FROM (
    SELECT
      e.id AS event_id, e.slug AS event_slug, e.name AS event_name,
      ces.pull_filters AS filters,
      ces.pull_include_emails AS include_emails,
      ces.is_paused AS paused,
      ces.max_credits_per_day,
      ces.max_unlocks_per_event AS max_total_contacts,
      CASE WHEN ces.pull_spend_day = (now() AT TIME ZONE 'utc')::date
           THEN ces.pull_credits_spent_today ELSE 0 END AS credits_spent_today,
      ces.last_api_pulled_at AS last_pulled_at,
      ces.subscribed_at AS created_at,
      (SELECT count(*) FROM customer_contact_access cca
       WHERE cca.user_id = p_user_id AND cca.event_id = e.id)::int AS unlocked_count
    FROM customer_event_subscriptions ces
    JOIN events e ON e.id = ces.event_id
    WHERE ces.user_id = p_user_id AND ces.auto_unlock_enabled = true
  ) t;
  RETURN json_build_object('rules', COALESCE(v_rows, '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.api_upsert_pull_rule(
  p_user_id uuid,
  p_event_id uuid,
  p_filters jsonb DEFAULT NULL,
  p_include_emails boolean DEFAULT NULL,
  p_max_credits_per_day integer DEFAULT NULL,
  p_max_total integer DEFAULT NULL,
  p_paused boolean DEFAULT NULL,
  p_enabled boolean DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row customer_event_subscriptions%ROWTYPE;
  v_event_slug text;
  v_event_name text;
BEGIN
  -- NULL keeps the existing value (PATCH); -1 clears a cap back to uncapped.
  IF p_max_credits_per_day IS NOT NULL AND p_max_credits_per_day < -1 THEN
    RETURN json_build_object('success', false, 'message', 'max_credits_per_day must be >= 0, or -1 to clear');
  END IF;
  IF p_max_total IS NOT NULL AND p_max_total < -1 THEN
    RETURN json_build_object('success', false, 'message', 'max_total_contacts must be >= 0, or -1 to clear');
  END IF;

  SELECT slug, name INTO v_event_slug, v_event_name FROM events WHERE id = p_event_id;
  IF v_event_name IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Event not found');
  END IF;

  INSERT INTO customer_event_subscriptions (
    user_id, event_id, auto_unlock_enabled, is_paused,
    pull_filters, pull_include_emails, max_credits_per_day, max_unlocks_per_event
  )
  VALUES (
    p_user_id, p_event_id,
    COALESCE(p_enabled, true),
    COALESCE(p_paused, false),
    COALESCE(p_filters, '{}'::jsonb),
    COALESCE(p_include_emails, true),
    CASE WHEN p_max_credits_per_day = -1 THEN NULL ELSE p_max_credits_per_day END,
    CASE WHEN p_max_total = -1 THEN NULL ELSE p_max_total END
  )
  ON CONFLICT (user_id, event_id) DO UPDATE SET
    auto_unlock_enabled = COALESCE(p_enabled, customer_event_subscriptions.auto_unlock_enabled),
    is_paused = COALESCE(p_paused, customer_event_subscriptions.is_paused),
    pull_filters = COALESCE(p_filters, customer_event_subscriptions.pull_filters),
    pull_include_emails = COALESCE(p_include_emails, customer_event_subscriptions.pull_include_emails),
    max_credits_per_day = CASE
      WHEN p_max_credits_per_day = -1 THEN NULL
      ELSE COALESCE(p_max_credits_per_day, customer_event_subscriptions.max_credits_per_day) END,
    max_unlocks_per_event = CASE
      WHEN p_max_total = -1 THEN NULL
      ELSE COALESCE(p_max_total, customer_event_subscriptions.max_unlocks_per_event) END
  RETURNING * INTO v_row;

  RETURN json_build_object(
    'success', true,
    'rule', json_build_object(
      'event_id', v_row.event_id,
      'event_slug', v_event_slug,
      'event_name', v_event_name,
      'enabled', v_row.auto_unlock_enabled,
      'paused', v_row.is_paused,
      'filters', v_row.pull_filters,
      'include_emails', v_row.pull_include_emails,
      'max_credits_per_day', v_row.max_credits_per_day,
      'max_total_contacts', v_row.max_unlocks_per_event,
      'last_pulled_at', v_row.last_api_pulled_at,
      'created_at', v_row.subscribed_at
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.api_delete_pull_rule(p_user_id uuid, p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_found int;
BEGIN
  -- Disable the rule and reset its config; the subscription row itself stays so
  -- dashboard My Events history keeps working.
  UPDATE customer_event_subscriptions
  SET auto_unlock_enabled = false,
      is_paused = false,
      pull_filters = '{}'::jsonb,
      pull_include_emails = true,
      max_credits_per_day = NULL,
      max_unlocks_per_event = NULL
  WHERE user_id = p_user_id AND event_id = p_event_id AND auto_unlock_enabled = true;
  GET DIAGNOSTICS v_found = ROW_COUNT;

  RETURN json_build_object('success', true, 'deleted', v_found > 0);
END;
$function$;

-- Distinct users with live rules, least-recently-drained first (for the cron drainer).
CREATE OR REPLACE FUNCTION public.api_list_pull_due_users(p_limit integer DEFAULT 100)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ces.user_id
  FROM customer_event_subscriptions ces
  WHERE ces.auto_unlock_enabled = true AND ces.is_paused = false
  GROUP BY ces.user_id
  ORDER BY MIN(ces.last_api_pulled_at) NULLS FIRST
  LIMIT p_limit;
$function$;

-- ============================================================
-- 7) Events list + unlock status (read side)
-- ============================================================

DROP FUNCTION IF EXISTS public.api_list_events();

CREATE OR REPLACE FUNCTION public.api_list_events(
  p_year integer DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_starts_after date DEFAULT NULL,
  p_starts_before date DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer;
  v_rows jsonb;
BEGIN
  SELECT count(*) INTO v_total
  FROM events e
  WHERE e.is_active = true
    AND (p_year IS NULL OR e.year = p_year)
    AND (p_region IS NULL OR lower(e.region) = lower(p_region))
    AND (p_country IS NULL OR lower(e.country) = lower(p_country))
    AND (p_industry IS NULL OR lower(e.industry) = lower(p_industry))
    AND (p_q IS NULL OR e.name ILIKE '%' || p_q || '%')
    AND (p_starts_after IS NULL OR e.start_date >= p_starts_after)
    AND (p_starts_before IS NULL OR e.start_date <= p_starts_before);

  SELECT jsonb_agg(to_jsonb(t)) INTO v_rows
  FROM (
    SELECT
      e.id AS event_id,
      e.name AS event_name,
      e.slug AS event_slug,
      e.year AS event_year,
      e.region AS event_region,
      e.country AS event_country,
      e.location AS event_location,
      e.start_date AS event_start_date,
      e.industry AS event_industry,
      -- Counts come from the facets cache (refreshed on a schedule): zero heavy
      -- aggregation per request. Live truth is the facets endpoint.
      COALESCE((e.facets_cache ->> 'matched')::bigint, 0) AS total_contacts,
      COALESCE((e.facets_cache ->> 'with_email')::bigint, 0) AS contacts_with_email,
      e.facets_cached_at AS counts_cached_at
    FROM events e
    WHERE e.is_active = true
      AND (p_year IS NULL OR e.year = p_year)
      AND (p_region IS NULL OR lower(e.region) = lower(p_region))
      AND (p_country IS NULL OR lower(e.country) = lower(p_country))
      AND (p_industry IS NULL OR lower(e.industry) = lower(p_industry))
      AND (p_q IS NULL OR e.name ILIKE '%' || p_q || '%')
      AND (p_starts_after IS NULL OR e.start_date >= p_starts_after)
      AND (p_starts_before IS NULL OR e.start_date <= p_starts_before)
    ORDER BY e.start_date DESC NULLS LAST, e.name ASC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN json_build_object(
    'events', COALESCE(v_rows, '[]'::jsonb),
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'has_more', (p_offset + p_limit) < v_total
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.api_get_event_unlock_status(p_user_id uuid, p_event_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_total integer;
  v_with_email integer;
  v_unlocked integer := 0;
  v_emails_unlocked integer := 0;
  v_balance integer := 0;
  v_auto_pull boolean := false;
BEGIN
  -- Same live counting path as facets and unlock (valid-email definition, no settle filter).
  SELECT count(*), count(*) FILTER (WHERE f.has_email)
  INTO v_total, v_with_email
  FROM public.event_filtered_contact_ids(p_event_id, '{}'::jsonb) f;

  IF p_user_id IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE email_unlocked)
    INTO v_unlocked, v_emails_unlocked
    FROM customer_contact_access
    WHERE user_id = p_user_id AND event_id = p_event_id;

    v_balance := api_get_user_credits(p_user_id);

    SELECT (ces.auto_unlock_enabled AND NOT ces.is_paused) INTO v_auto_pull
    FROM customer_event_subscriptions ces
    WHERE ces.user_id = p_user_id AND ces.event_id = p_event_id;
    v_auto_pull := COALESCE(v_auto_pull, false);
  END IF;

  RETURN json_build_object(
    'total_contacts', v_total,
    'contacts_with_email', v_with_email,
    'unlocked_count', v_unlocked,
    'emails_unlocked', v_emails_unlocked,
    'remaining_count', v_total - v_unlocked,
    'user_balance', v_balance,
    'auto_pull_enabled', v_auto_pull
  );
END;
$function$;

-- ============================================================
-- 8) Grants: service_role only (routes authenticate the API key first).
-- New functions default to PUBLIC execute, so revoke explicitly.
-- ============================================================

REVOKE ALL ON FUNCTION public.api_unlock_event_contacts(uuid, uuid, integer, jsonb, boolean, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_unlock_event_contacts(uuid, uuid, integer, jsonb, boolean, integer, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.api_reveal_event_emails(uuid, uuid, uuid[], jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_reveal_event_emails(uuid, uuid, uuid[], jsonb, integer) TO service_role;

REVOKE ALL ON FUNCTION public.api_get_event_filter_facets(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_get_event_filter_facets(uuid, uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.api_get_unlocked_contacts(uuid, uuid, jsonb, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_get_unlocked_contacts(uuid, uuid, jsonb, integer, integer, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.api_get_all_unlocked_contacts(uuid, integer, integer, timestamp with time zone, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_get_all_unlocked_contacts(uuid, integer, integer, timestamp with time zone, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.api_run_pull_rules(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_run_pull_rules(uuid, integer, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.api_list_pull_rules(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_list_pull_rules(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.api_upsert_pull_rule(uuid, uuid, jsonb, boolean, integer, integer, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_upsert_pull_rule(uuid, uuid, jsonb, boolean, integer, integer, boolean, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.api_delete_pull_rule(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_delete_pull_rule(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.api_list_pull_due_users(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_list_pull_due_users(integer) TO service_role;

REVOKE ALL ON FUNCTION public.api_list_events(integer, text, text, text, text, date, date, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_list_events(integer, text, text, text, text, date, date, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.api_get_event_unlock_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_get_event_unlock_status(uuid, uuid) TO service_role;
