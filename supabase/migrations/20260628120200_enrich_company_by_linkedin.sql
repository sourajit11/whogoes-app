-- Inline company-size enrichment for the Moltsets-first workflows.
--
-- enrich_company() needs a company_id, but inline (in the contact/mention flow) the
-- company row may not exist yet. This thin wrapper resolves-or-creates the company by
-- its LinkedIn URL via the existing upsert_company() (idempotent on normalized URL,
-- same primitive enrich_contact uses), then applies the full enrich_company() field
-- set. Order-independent with enrich_contact: both go through upsert_company.

CREATE OR REPLACE FUNCTION public.enrich_company_by_linkedin(
  p_company_linkedin_url text,
  p_name                 text DEFAULT NULL,
  p_domain               text DEFAULT NULL,
  p_website              text DEFAULT NULL,
  p_industry             text DEFAULT NULL,
  p_size_range           text DEFAULT NULL,
  p_description          text DEFAULT NULL,
  p_headquarters_city    text DEFAULT NULL,
  p_headquarters_country text DEFAULT NULL,
  p_founded_year         integer DEFAULT NULL,
  p_specialties          text DEFAULT NULL,
  p_company_type         text DEFAULT NULL,
  p_logo_url             text DEFAULT NULL,
  p_employee_count       integer DEFAULT NULL,
  p_follower_count       integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF nullif(trim(coalesce(p_company_linkedin_url, '')), '') IS NULL THEN
    RETURN jsonb_build_object('company_id', NULL, 'error', 'no_linkedin_url');
  END IF;

  SELECT (public.upsert_company(
    p_linkedin_url := p_company_linkedin_url,
    p_name         := p_name,
    p_domain       := p_domain,
    p_website      := p_website,
    p_industry     := p_industry,
    p_size_range   := p_size_range
  ))->>'company_id' INTO v_company_id;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('company_id', NULL, 'error', 'upsert_failed');
  END IF;

  RETURN public.enrich_company(
    p_company_id          := v_company_id::uuid,
    p_name                := p_name,
    p_domain              := p_domain,
    p_website             := p_website,
    p_industry            := p_industry,
    p_size_range          := p_size_range,
    p_description         := p_description,
    p_headquarters_city   := p_headquarters_city,
    p_headquarters_country:= p_headquarters_country,
    p_founded_year        := p_founded_year,
    p_specialties         := p_specialties,
    p_company_type        := p_company_type,
    p_logo_url            := p_logo_url,
    p_employee_count      := p_employee_count,
    p_follower_count      := p_follower_count
  );
END;
$$;

-- Harden tag_contact_event_role: if the caller passes no role, fall back to the role
-- already extracted onto the post (Phase-2 LLM) instead of demoting it to attendee.
CREATE OR REPLACE FUNCTION public.tag_contact_event_role(
  p_contact_id      uuid,
  p_event_id        uuid,
  p_post_id         uuid,
  p_extracted_role  text DEFAULT NULL,
  p_role_confidence text DEFAULT NULL,
  p_role_evidence   text DEFAULT NULL,
  p_is_speaker      boolean DEFAULT false
)
RETURNS text
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
  v_role_in     text;
  v_conf        text;
BEGIN
  -- Effective role: caller-provided wins, else keep what the post already has.
  v_role_in := nullif(trim(coalesce(p_extracted_role, '')), '');
  IF v_role_in IS NULL AND p_post_id IS NOT NULL THEN
    SELECT extracted_event_role INTO v_role_in FROM posts WHERE id = p_post_id;
  END IF;

  -- Persist the raw per-post extraction only when the caller supplied one.
  IF p_post_id IS NOT NULL AND nullif(trim(coalesce(p_extracted_role, '')), '') IS NOT NULL THEN
    UPDATE posts
       SET extracted_event_role = p_extracted_role,
           role_is_speaker       = role_is_speaker OR coalesce(p_is_speaker, false),
           role_evidence         = coalesce(p_role_evidence, role_evidence),
           role_confidence       = coalesce(p_role_confidence, role_confidence)
     WHERE id = p_post_id;
  END IF;

  UPDATE contact_events
     SET is_speaker = is_speaker OR coalesce(p_is_speaker, false)
   WHERE contact_id = p_contact_id
     AND event_id   = p_event_id;

  SELECT author_type INTO v_author_type FROM posts WHERE id = p_post_id;
  SELECT source_type INTO v_source_type
    FROM contact_events
   WHERE contact_id = p_contact_id AND event_id = p_event_id
   ORDER BY (post_id = p_post_id) DESC
   LIMIT 1;

  SELECT current_company_id INTO v_company_id FROM contacts WHERE id = p_contact_id;
  IF v_company_id IS NULL THEN
    SELECT company_id INTO v_company_id FROM posts WHERE id = p_post_id;
  END IF;
  IF v_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT organizer_company_id INTO v_org FROM events WHERE id = p_event_id;

  v_ceiling := CASE
    WHEN v_author_type = 'company' AND coalesce(v_source_type, '') <> 'repost' THEN 4
    WHEN v_author_type = 'company' AND v_source_type = 'repost'                THEN 2
    WHEN v_author_type = 'person'  AND v_source_type = 'post_author'           THEN 3
    ELSE 1
  END;

  v_raw   := public.event_role_rank(v_role_in);
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
    WHEN v_ceiling <= 2       THEN 'likely'
    ELSE 'confirmed'
  END;

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

REVOKE ALL ON FUNCTION public.enrich_company_by_linkedin(text, text, text, text, text, text, text, text, text, integer, text, text, text, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.enrich_company_by_linkedin(text, text, text, text, text, text, text, text, text, integer, text, text, text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.tag_contact_event_role(uuid, uuid, uuid, text, text, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.tag_contact_event_role(uuid, uuid, uuid, text, text, text, boolean) TO service_role;
