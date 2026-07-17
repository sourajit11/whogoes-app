-- Fix audit_role_qualification:
--   (a) event_contact_facts.created_at is the contact-link time (copied from
--       contact_events.created_at), NOT a facts-refresh timestamp, so the old
--       timestamp-based "facts_behind_roles" check was a false positive. Replace
--       it with a CONTENT check: recompute each sampled event's expected facts
--       role (mirror of refresh_event_contact_facts) and count contacts whose
--       stored facts role disagrees. This is the real denormalization-integrity test.
--   (b) DROP the _ae temp table at entry so the function can be called more than
--       once in a single transaction.

CREATE OR REPLACE FUNCTION public.audit_role_qualification(p_sample integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE
  v_cron jsonb; v_queue jsonb; v_stale jsonb;
  v_dist jsonb; v_tiers jsonb; v_hygiene jsonb; v_consistency jsonb;
  v_sample_events int := 0; v_sample_drift int := 0; v_facts_drift_events int := 0;
  v_examples jsonb := '[]'::jsonb; r record; v_ndiff int; v_fdiff int;
BEGIN
  DROP TABLE IF EXISTS _ae;
  CREATE TEMP TABLE _ae ON COMMIT DROP AS
  SELECT p.event_id, max(coalesce(p.updated_at, p.created_at)) AS last_post, count(*) AS n_posts
  FROM posts p JOIN events e ON e.id = p.event_id AND e.is_active = true
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

  -- 2. queue depth + oldest age (oldest > ~10m => cron not draining)
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
    SELECT a.event_id, round(extract(epoch FROM (a.last_post - c.last_resolve))/60)::int AS minutes_behind
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

  -- 4. sampled consistency: stored roles vs fresh recompute, AND stored facts vs
  --    fresh facts role, for recently-resolved active events (skip huge events).
  FOR r IN
    SELECT a.event_id, e.name FROM _ae a
    JOIN events e ON e.id = a.event_id
    JOIN (SELECT event_id, max(computed_at) lr FROM company_event_roles GROUP BY event_id) cm
      ON cm.event_id = a.event_id
    WHERE a.n_posts < 3000
    ORDER BY cm.lr DESC LIMIT p_sample
  LOOP
    -- company_event_roles drift
    SELECT count(*) INTO v_ndiff
    FROM (
      SELECT s.role AS srole, f.role AS frole
      FROM (SELECT company_id, role FROM company_event_roles WHERE event_id = r.event_id) s
      FULL JOIN public._resolve_event_roles_calc(r.event_id) f ON f.company_id = s.company_id
    ) d
    WHERE coalesce(d.srole,'~') IS DISTINCT FROM coalesce(d.frole,'~');

    -- event_contact_facts role drift (mirror of refresh_event_contact_facts)
    SELECT count(*) INTO v_fdiff
    FROM (
      SELECT DISTINCT ON (ce.contact_id) ce.contact_id,
        CASE WHEN coalesce(cer.role,'attendee') IN ('organizer','sponsor','exhibitor') THEN cer.role
             WHEN coalesce(ce.is_speaker,false) OR ce.source_type IN ('post_author','mentioned') THEN 'attendee'
             ELSE 'expected_attendee' END AS role
      FROM contact_events ce
      JOIN contacts c ON c.id = ce.contact_id
      LEFT JOIN company_event_roles cer ON cer.event_id = r.event_id AND cer.company_id = c.current_company_id
      WHERE ce.event_id = r.event_id
      ORDER BY ce.contact_id, coalesce(ce.is_speaker,false) DESC,
               (ce.source_type IN ('post_author','mentioned')) DESC, ce.created_at DESC NULLS LAST
    ) exp
    FULL JOIN (SELECT contact_id, role FROM event_contact_facts WHERE event_id = r.event_id) sto
      ON sto.contact_id = exp.contact_id
    WHERE coalesce(exp.role,'~') IS DISTINCT FROM coalesce(sto.role,'~');

    v_sample_events := v_sample_events + 1;
    IF v_ndiff > 0 THEN v_sample_drift := v_sample_drift + 1; END IF;
    IF v_fdiff > 0 THEN v_facts_drift_events := v_facts_drift_events + 1; END IF;
    IF (v_ndiff > 0 OR v_fdiff > 0) AND jsonb_array_length(v_examples) < 5 THEN
      v_examples := v_examples || jsonb_build_object(
        'event_id', r.event_id, 'name', r.name, 'role_diff', v_ndiff, 'facts_diff', v_fdiff);
    END IF;
  END LOOP;
  v_consistency := jsonb_build_object(
    'events_sampled', v_sample_events,
    'events_with_role_drift', v_sample_drift,
    'events_with_facts_drift', v_facts_drift_events,
    'examples', v_examples);

  -- 5. company-role distribution (global)
  SELECT jsonb_build_object(
    'organizer', count(*) FILTER (WHERE role='organizer'),
    'sponsor', count(*) FILTER (WHERE role='sponsor'),
    'exhibitor', count(*) FILTER (WHERE role='exhibitor'),
    'attendee', count(*) FILTER (WHERE role='attendee'),
    'total', count(*),
    'confirmed', count(*) FILTER (WHERE confidence='confirmed'),
    'likely', count(*) FILTER (WHERE confidence='likely')
  ) INTO v_dist FROM company_event_roles;

  -- 6. contact display tiers (denormalized facts)
  SELECT jsonb_build_object(
    'organizer', count(*) FILTER (WHERE role='organizer'),
    'sponsor', count(*) FILTER (WHERE role='sponsor'),
    'exhibitor', count(*) FILTER (WHERE role='exhibitor'),
    'attendee', count(*) FILTER (WHERE role='attendee'),
    'expected_attendee', count(*) FILTER (WHERE role='expected_attendee'),
    'speakers', count(*) FILTER (WHERE is_speaker)
  ) INTO v_tiers FROM event_contact_facts;

  -- 7. hygiene: non-organizer roles whose evidence post is missing or rejected
  SELECT jsonb_build_object('roles_with_bad_evidence', count(*)) INTO v_hygiene
  FROM company_event_roles cer
  LEFT JOIN posts p ON p.id = cer.evidence_post_id
  WHERE cer.role IN ('sponsor','exhibitor','attendee')
    AND cer.evidence_post_id IS NOT NULL
    AND (p.id IS NULL OR coalesce(p.post_type,'') LIKE '%rejected%');

  RETURN jsonb_build_object(
    'generated_at', now(), 'cron', v_cron, 'queue', v_queue, 'staleness', v_stale,
    'consistency', v_consistency,
    'distribution_company_roles', v_dist, 'distribution_contact_tiers', v_tiers, 'hygiene', v_hygiene
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.audit_role_qualification(integer) TO service_role;
