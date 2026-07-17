-- Pulled from remote on 2026-05-15. Originally applied via Supabase Studio.
-- Captured into local migrations for parity (rule: all DDL must be tracked).


CREATE OR REPLACE FUNCTION public.upsert_contact(p_linkedin_url text, p_full_name text, p_source text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_contact_id uuid;
  v_is_new boolean := false;
  v_clean_name text := lower(trim(coalesce(p_full_name, '')));
  v_match_count integer;
begin
  -- Guard: silently skip company/showcase LinkedIn URLs
  -- These belong in the companies table, not contacts
  IF p_linkedin_url LIKE '%/company/%' OR p_linkedin_url LIKE '%/showcase/%' THEN
    RETURN json_build_object(
      'contact_id', NULL,
      'is_new', false,
      'skipped', 'company_url'
    );
  END IF;

  -- Step 1: Try exact linkedin_url match (original behavior)
  SELECT id INTO v_contact_id
  FROM public.contacts
  WHERE linkedin_url = p_linkedin_url;

  IF v_contact_id IS NOT NULL THEN
    RETURN json_build_object('contact_id', v_contact_id, 'is_new', false);
  END IF;

  -- Step 2: For placeholder URLs, try to find existing contact by name
  IF p_linkedin_url LIKE 'placeholder-mentioned-%' AND v_clean_name != '' THEN
    -- Step 2a: Check for a real (non-placeholder) contact with this name
    SELECT count(*), min(id::text)::uuid
    INTO v_match_count, v_contact_id
    FROM public.contacts
    WHERE linkedin_url NOT LIKE 'placeholder-mentioned-%'
      AND lower(trim(full_name)) = v_clean_name;

    -- Only use if exactly 1 real contact has this name (unambiguous)
    IF v_match_count = 1 AND v_contact_id IS NOT NULL THEN
      RETURN json_build_object('contact_id', v_contact_id, 'is_new', false);
    END IF;

    -- Reset if ambiguous
    v_contact_id := NULL;

    -- Step 2b: Check for an existing placeholder contact with the same name
    -- This prevents creating duplicate placeholder contacts for the same person
    -- mentioned across multiple posts (e.g. from regional company pages)
    SELECT min(id::text)::uuid
    INTO v_contact_id
    FROM public.contacts
    WHERE linkedin_url LIKE 'placeholder-mentioned-%'
      AND lower(trim(full_name)) = v_clean_name;

    IF v_contact_id IS NOT NULL THEN
      RETURN json_build_object('contact_id', v_contact_id, 'is_new', false);
    END IF;
  END IF;

  -- Step 3: Insert new contact with ON CONFLICT for race safety
  INSERT INTO public.contacts (linkedin_url, full_name, source)
  VALUES (p_linkedin_url, p_full_name, p_source)
  ON CONFLICT (linkedin_url) DO NOTHING
  RETURNING id INTO v_contact_id;

  IF v_contact_id IS NOT NULL THEN
    v_is_new := true;
  ELSE
    -- Race condition: another process inserted first, fetch their row
    SELECT id INTO v_contact_id
    FROM public.contacts
    WHERE linkedin_url = p_linkedin_url;
  END IF;

  RETURN json_build_object(
    'contact_id', v_contact_id,
    'is_new', v_is_new
  );
end;
$function$;
