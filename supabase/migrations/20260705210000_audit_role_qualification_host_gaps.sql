-- Adds check R10 (host-organizer gaps) to audit_role_qualification: active events with
-- organizer_company_id IS NULL where one company both authored company-page posts AND holds
-- a large share of the event's contacts. Organizer can only be set via events.organizer_company_id
-- (see resolve_company_event_roles), so these events silently default their true host to 'attendee'
-- (e.g. Salesforce at Dreamforce). The fix is human-confirmed via scripts/suggest-organizers.mjs.
-- Everything else is unchanged from 20260628122000_audit_role_qualification.sql.

CREATE OR REPLACE FUNCTION public.audit_role_qualification(p_sample integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_cron        jsonb;
  v_queue       jsonb;
  v_stale       jsonb;
  v_facts       jsonb;
  v_dist        jsonb;
  v_tiers       jsonb;
  v_hygiene     jsonb;
  v_consistency jsonb;
  v_missing_org jsonb;
  v_sample_events int := 0;
  v_sample_drift  int := 0;
  v_examples    jsonb := '[]'::jsonb;
  r record;
  v_ndiff int;
BEGIN
  -- Active-event post aggregates (bounded to is_active events) reused below.
  CREATE TEMP TABLE _ae ON COMMIT DROP AS
  SELECT p.event_id,
         max(coalesce(p.updated_at, p.created_at)) AS last_post,
         count(*) AS n_posts
  FROM posts p
  JOIN events e ON e.id = p.event_id AND e.is_active = true
  WHERE coalesce(p.post_type, '') NOT LIKE '%rejected%'
  GROUP BY p.event_id;

  -- 1. cron health
  v_cron := jsonb_build_object(
    'job_exists', (SELECT count(*) FROM cron.job WHERE jobname='resolve-dirty-event-roles') > 0,
    'active',     (SELECT bool_or(active) FROM cron.job WHERE jobname='resolve-dirty-event-roles'),
    'last_status',(SELECT d.status FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
                    WHERE j.jobname='resolve-dirty-event-roles' ORDER BY d.start_time DESC LIMIT 1),
    'minutes_since_last_run',
                  (SELECT round(extract(epoch FROM (now()-d.start_time))/60)::int
                    FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
                    WHERE j.jobname='resolve-dirty-event-roles' ORDER BY d.start_time DESC LIMIT 1)
  );

  -- 2. queue depth + oldest item age (oldest > ~10m means the cron is not draining)
  SELECT jsonb_build_object(
    'depth', count(*),
    'oldest_minutes', coalesce(round(extract(epoch FROM (now()-min(enqueued_at)))/60)::int, 0)
  ) INTO v_queue FROM event_role_queue;

  -- 3. staleness: active events whose newest qualified post is newer than their
  --    newest role resolve by >15m AND not currently queued (a missed enqueue).
  WITH cer_mx AS (
    SELECT event_id, max(computed_at) AS last_resolve
    FROM company_event_roles WHERE event_id IN (SELECT event_id FROM _ae) GROUP BY event_id
  ),
  behind AS (
    SELECT a.event_id,
           round(extract(epoch FROM (a.last_post - c.last_resolve))/60)::int AS minutes_behind
    FROM _ae a JOIN cer_mx c ON c.event_id = a.event_id
    WHERE a.last_post > c.last_resolve + interval '15 minutes'
      AND a.event_id NOT IN (SELECT event_id FROM event_role_queue)
  )
  SELECT jsonb_build_object(
    'active_events_resolved', (SELECT count(*) FROM cer_mx),
    'roles_behind_posts',     (SELECT count(*) FROM behind),
    'examples', coalesce((SELECT jsonb_agg(x) FROM
        (SELECT event_id, minutes_behind FROM behind ORDER BY minutes_behind DESC LIMIT 5) x), '[]'::jsonb)
  ) INTO v_stale;

  -- 4. facts freshness: pre-unlock browse (event_contact_facts) older than the
  --    resolved roles by >15m means the browse view shows stale roles.
  WITH cer_mx AS (
    SELECT event_id, max(computed_at) AS lr FROM company_event_roles
    WHERE event_id IN (SELECT event_id FROM _ae) GROUP BY event_id
  ),
  facts_mx AS (
    SELECT event_id, max(created_at) AS lf FROM event_contact_facts
    WHERE event_id IN (SELECT event_id FROM _ae) GROUP BY event_id
  )
  SELECT jsonb_build_object(
    'facts_behind_roles', count(*)
  ) INTO v_facts
  FROM cer_mx c JOIN facts_mx f ON f.event_id = c.event_id
  WHERE c.lr > f.lf + interval '15 minutes';

  -- 5. resolver consistency: stored company_event_roles vs a fresh recompute, for
  --    a sample of recently-resolved active events (skip huge events to stay fast).
  FOR r IN
    SELECT a.event_id, e.name
    FROM _ae a
    JOIN events e ON e.id = a.event_id
    JOIN (SELECT event_id, max(computed_at) lr FROM company_event_roles GROUP BY event_id) cm
      ON cm.event_id = a.event_id
    WHERE a.n_posts < 3000
    ORDER BY cm.lr DESC
    LIMIT p_sample
  LOOP
    SELECT count(*) INTO v_ndiff
    FROM (
      SELECT coalesce(s.company_id, f.company_id) AS cid, s.role AS srole, f.role AS frole
      FROM (SELECT company_id, role FROM company_event_roles WHERE event_id = r.event_id) s
      FULL JOIN public._resolve_event_roles_calc(r.event_id) f ON f.company_id = s.company_id
    ) d
    WHERE coalesce(d.srole,'~') IS DISTINCT FROM coalesce(d.frole,'~');

    v_sample_events := v_sample_events + 1;
    IF v_ndiff > 0 THEN
      v_sample_drift := v_sample_drift + 1;
      IF jsonb_array_length(v_examples) < 5 THEN
        v_examples := v_examples || jsonb_build_object('event_id', r.event_id, 'name', r.name, 'companies_diff', v_ndiff);
      END IF;
    END IF;
  END LOOP;
  v_consistency := jsonb_build_object(
    'events_sampled', v_sample_events,
    'events_with_role_drift', v_sample_drift,
    'examples', v_examples
  );

  -- 6. company-role distribution (global sanity / trend)
  SELECT jsonb_build_object(
    'organizer', count(*) FILTER (WHERE role='organizer'),
    'sponsor',   count(*) FILTER (WHERE role='sponsor'),
    'exhibitor', count(*) FILTER (WHERE role='exhibitor'),
    'attendee',  count(*) FILTER (WHERE role='attendee'),
    'total',     count(*),
    'confirmed', count(*) FILTER (WHERE confidence='confirmed'),
    'likely',    count(*) FILTER (WHERE confidence='likely')
  ) INTO v_dist FROM company_event_roles;

  -- contact display tiers from the denormalized facts
  SELECT jsonb_build_object(
    'organizer', count(*) FILTER (WHERE role='organizer'),
    'sponsor',   count(*) FILTER (WHERE role='sponsor'),
    'exhibitor', count(*) FILTER (WHERE role='exhibitor'),
    'attendee',  count(*) FILTER (WHERE role='attendee'),
    'expected_attendee', count(*) FILTER (WHERE role='expected_attendee'),
    'speakers',  count(*) FILTER (WHERE is_speaker)
  ) INTO v_tiers FROM event_contact_facts;

  -- 7. hygiene: non-organizer roles whose evidence post is missing or rejected
  SELECT jsonb_build_object(
    'roles_with_bad_evidence', count(*)
  ) INTO v_hygiene
  FROM company_event_roles cer
  LEFT JOIN posts p ON p.id = cer.evidence_post_id
  WHERE cer.role IN ('sponsor','exhibitor','attendee')
    AND cer.evidence_post_id IS NOT NULL
    AND (p.id IS NULL OR coalesce(p.post_type,'') LIKE '%rejected%');

  -- 8 (R10). host-organizer gaps: active events with organizer_company_id IS NULL where one
  --    company BOTH authored non-rejected company-page posts AND holds a large share of the
  --    event's contacts. That pattern is a near-certain host (e.g. Salesforce at Dreamforce)
  --    that is currently defaulting to 'attendee'. Fix each via scripts/suggest-organizers.mjs.
  WITH null_org AS (
    SELECT id FROM events WHERE organizer_company_id IS NULL AND is_active = true
  ),
  ev_tot AS (
    SELECT ce.event_id, count(DISTINCT ce.contact_id) AS total
    FROM contact_events ce
    WHERE ce.event_id IN (SELECT id FROM null_org)
    GROUP BY ce.event_id
  ),
  comp_share AS (
    SELECT ce.event_id, ct.current_company_id AS cid, count(DISTINCT ce.contact_id) AS n
    FROM contact_events ce
    JOIN contacts ct ON ct.id = ce.contact_id
    WHERE ce.event_id IN (SELECT id FROM null_org) AND ct.current_company_id IS NOT NULL
    GROUP BY ce.event_id, ct.current_company_id
  ),
  page_posts AS (
    SELECT p.event_id, p.company_id AS cid, count(*) AS pp
    FROM posts p
    WHERE p.event_id IN (SELECT id FROM null_org)
      AND p.author_type = 'company' AND p.company_id IS NOT NULL
      AND coalesce(p.post_type,'') NOT LIKE '%rejected%'
    GROUP BY p.event_id, p.company_id
  ),
  cand AS (
    SELECT s.event_id, s.cid, s.n, t.total, coalesce(pp.pp,0) AS pp,
           s.n::numeric / nullif(t.total,0) AS share
    FROM comp_share s
    JOIN ev_tot t ON t.event_id = s.event_id
    LEFT JOIN page_posts pp ON pp.event_id = s.event_id AND pp.cid = s.cid
    WHERE t.total >= 10
      AND ( (coalesce(pp.pp,0) >= 1 AND s.n::numeric / nullif(t.total,0) >= 0.30)
            OR s.n::numeric / nullif(t.total,0) >= 0.50 )
  ),
  best AS (
    SELECT DISTINCT ON (event_id) event_id, cid, n, total, pp, share
    FROM cand ORDER BY event_id, pp DESC, share DESC
  )
  SELECT jsonb_build_object(
    'events_missing_organizer', (SELECT count(*) FROM best),
    'examples', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT b.event_id, e.name AS event, co.name AS host_candidate,
               b.pp AS company_posts, round(b.share*100)::int AS pct_of_contacts
        FROM best b JOIN events e ON e.id = b.event_id JOIN companies co ON co.id = b.cid
        ORDER BY b.pp DESC, b.share DESC LIMIT 8) x), '[]'::jsonb)
  ) INTO v_missing_org;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'cron', v_cron,
    'queue', v_queue,
    'staleness', v_stale,
    'facts', v_facts,
    'consistency', v_consistency,
    'distribution_company_roles', v_dist,
    'distribution_contact_tiers', v_tiers,
    'hygiene', v_hygiene,
    'host_organizer_gaps', v_missing_org
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.audit_role_qualification(integer) TO service_role;
