-- Real-time, per-contact event-role tagging for the Moltsets-first enrichment
-- workflows. The batch resolver resolve_company_event_roles() rescans every post
-- of an event; in the enrichment loop we instead apply ONE post's claim
-- incrementally as each contact is enriched.
--
-- Reuses the exact ladder + guardrails from 20260620203613_role_resolution_functions.sql:
--   organizer(4) > sponsor(3) > exhibitor(2) > attendee(1), highest credible claim wins.
--   Ceilings by source: company_page=4, first_person=3, company_repost=2, repost/mention=1.
-- Writes: posts extraction columns, contact_events.is_speaker, and an incremental
-- upsert into company_event_roles (only elevates, never demotes a stronger claim).

-- Shared rank mapping so the upsert can compare the new claim against the stored role.
CREATE OR REPLACE FUNCTION public.event_role_rank(p_role text)
RETURNS int
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_role, ''))
           WHEN 'organizer' THEN 4
           WHEN 'sponsor'   THEN 3
           WHEN 'exhibitor' THEN 2
           ELSE 1            -- attendee / unknown
         END;
$$;

CREATE OR REPLACE FUNCTION public.tag_contact_event_role(
  p_contact_id      uuid,
  p_event_id        uuid,
  p_post_id         uuid,
  p_extracted_role  text,
  p_role_confidence text DEFAULT NULL,
  p_role_evidence   text DEFAULT NULL,
  p_is_speaker      boolean DEFAULT false
)
RETURNS text                      -- the resolved company role (or NULL if no company)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author_type text;
  v_source_type text;
  v_company_id  uuid;
  v_org         uuid;
  v_ceiling     int;
  v_raw         int;
  v_rrank       int;
  v_role        text;
  v_conf        text;
BEGIN
  -- 1. Persist the raw per-post extraction (forward-compatible with the batch resolver).
  IF p_post_id IS NOT NULL THEN
    UPDATE posts
       SET extracted_event_role = p_extracted_role,
           role_is_speaker       = coalesce(p_is_speaker, false),
           role_evidence         = p_role_evidence,
           role_confidence       = p_role_confidence
     WHERE id = p_post_id;
  END IF;

  -- 2. Per-contact speaker flag (sticky: never unset a previously-true flag).
  UPDATE contact_events
     SET is_speaker = is_speaker OR coalesce(p_is_speaker, false)
   WHERE contact_id = p_contact_id
     AND event_id   = p_event_id;

  -- Source context for guardrails.
  SELECT author_type INTO v_author_type FROM posts WHERE id = p_post_id;
  SELECT source_type INTO v_source_type
    FROM contact_events
   WHERE contact_id = p_contact_id AND event_id = p_event_id
   ORDER BY (post_id = p_post_id) DESC
   LIMIT 1;

  -- Company the role attaches to (contact inherits company role for the event).
  SELECT current_company_id INTO v_company_id FROM contacts WHERE id = p_contact_id;
  IF v_company_id IS NULL THEN
    SELECT company_id INTO v_company_id FROM posts WHERE id = p_post_id;
  END IF;
  IF v_company_id IS NULL THEN
    RETURN NULL;   -- nothing to attach a company-grained role to
  END IF;

  SELECT organizer_company_id INTO v_org FROM events WHERE id = p_event_id;

  -- 3. Apply ladder + ceiling (mirrors resolve_company_event_roles).
  v_ceiling := CASE
    WHEN v_author_type = 'company' AND coalesce(v_source_type, '') <> 'repost' THEN 4  -- company_page
    WHEN v_author_type = 'company' AND v_source_type = 'repost'                THEN 2  -- company_repost
    WHEN v_author_type = 'person'  AND v_source_type = 'post_author'           THEN 3  -- first_person
    ELSE 1                                                                              -- repost / mention / weak
  END;

  v_raw   := public.event_role_rank(p_extracted_role);
  v_rrank := least(greatest(v_raw, 1), v_ceiling);

  IF v_company_id = v_org OR v_rrank = 4 THEN
    v_role := 'organizer';
  ELSIF v_rrank = 3 THEN
    v_role := 'sponsor';
  ELSIF v_rrank = 2 THEN
    v_role := 'exhibitor';
  ELSE
    v_role := 'attendee';
  END IF;

  v_conf := CASE
    WHEN v_company_id = v_org THEN 'confirmed'
    WHEN v_ceiling <= 2       THEN 'likely'   -- reposts / mentions / company-reposts
    ELSE 'confirmed'
  END;

  -- 4. Incremental upsert: only elevate when this claim outranks the stored role.
  INSERT INTO company_event_roles (event_id, company_id, role, confidence, evidence_post_id, computed_at)
  VALUES (p_event_id, v_company_id, v_role, v_conf, p_post_id, now())
  ON CONFLICT (event_id, company_id) DO UPDATE
    SET role             = excluded.role,
        confidence       = excluded.confidence,
        evidence_post_id = excluded.evidence_post_id,
        computed_at      = now()
  WHERE public.event_role_rank(excluded.role) > public.event_role_rank(company_event_roles.role);

  RETURN v_role;
END;
$$;

REVOKE ALL ON FUNCTION public.tag_contact_event_role(uuid, uuid, uuid, text, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.tag_contact_event_role(uuid, uuid, uuid, text, text, text, boolean) TO service_role;
