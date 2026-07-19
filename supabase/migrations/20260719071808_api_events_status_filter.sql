-- /v1/events: match the in-app Browse Events page exactly.
--
-- The API listed only is_active events while the dashboard browse shows every
-- event with an Active/Completed badge (is_whogoes_active), so events visible
-- in the app (e.g. finished shows) were invisible to the API. Now:
--   * new `p_status` filter: 'active' | 'completed', same values as the UI chip
--   * each row carries `status` so the filter values are discoverable
--   * no status: all events, active group first, then completed
--   * within a group, browse-page order: upcoming first, then biggest list,
--     ties nearest to today
--   * `p_q` searches name OR location like the browse search box
--   * new `p_min_contacts` mirroring the browse "min contacts" filter

DROP FUNCTION IF EXISTS public.api_list_events(integer, text, text, text, text, date, date, integer, integer);

CREATE OR REPLACE FUNCTION public.api_list_events(
  p_year integer DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_starts_after date DEFAULT NULL,
  p_starts_before date DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_status text DEFAULT NULL,
  p_min_contacts integer DEFAULT NULL
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
  WHERE (p_status IS NULL
         OR (p_status = 'active' AND COALESCE(e.is_whogoes_active, false))
         OR (p_status = 'completed' AND NOT COALESCE(e.is_whogoes_active, false)))
    AND (p_year IS NULL OR e.year = p_year)
    AND (p_region IS NULL OR lower(e.region) = lower(p_region))
    AND (p_country IS NULL OR lower(e.country) = lower(p_country))
    AND (p_industry IS NULL OR lower(e.industry) = lower(p_industry))
    AND (p_q IS NULL OR e.name ILIKE '%' || p_q || '%' OR COALESCE(e.location, '') ILIKE '%' || p_q || '%')
    AND (p_starts_after IS NULL OR e.start_date >= p_starts_after)
    AND (p_starts_before IS NULL OR e.start_date <= p_starts_before)
    AND (p_min_contacts IS NULL OR COALESCE((e.facets_cache ->> 'matched')::bigint, 0) >= p_min_contacts);

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
      CASE WHEN COALESCE(e.is_whogoes_active, false) THEN 'active' ELSE 'completed' END AS status,
      -- Counts come from the facets cache (refreshed on a schedule): zero heavy
      -- aggregation per request. Live truth is the facets endpoint.
      COALESCE((e.facets_cache ->> 'matched')::bigint, 0) AS total_contacts,
      COALESCE((e.facets_cache ->> 'with_email')::bigint, 0) AS contacts_with_email,
      e.facets_cached_at AS counts_cached_at
    FROM events e
    WHERE (p_status IS NULL
           OR (p_status = 'active' AND COALESCE(e.is_whogoes_active, false))
           OR (p_status = 'completed' AND NOT COALESCE(e.is_whogoes_active, false)))
      AND (p_year IS NULL OR e.year = p_year)
      AND (p_region IS NULL OR lower(e.region) = lower(p_region))
      AND (p_country IS NULL OR lower(e.country) = lower(p_country))
      AND (p_industry IS NULL OR lower(e.industry) = lower(p_industry))
      AND (p_q IS NULL OR e.name ILIKE '%' || p_q || '%' OR COALESCE(e.location, '') ILIKE '%' || p_q || '%')
      AND (p_starts_after IS NULL OR e.start_date >= p_starts_after)
      AND (p_starts_before IS NULL OR e.start_date <= p_starts_before)
      AND (p_min_contacts IS NULL OR COALESCE((e.facets_cache ->> 'matched')::bigint, 0) >= p_min_contacts)
    ORDER BY
      COALESCE(e.is_whogoes_active, false) DESC,
      (e.start_date IS NOT NULL AND e.start_date >= CURRENT_DATE) DESC,
      COALESCE((e.facets_cache ->> 'matched')::bigint, 0) DESC,
      (CASE WHEN e.start_date IS NULL THEN NULL ELSE abs(e.start_date - CURRENT_DATE) END) ASC NULLS LAST,
      e.name ASC
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

REVOKE ALL ON FUNCTION public.api_list_events(integer, text, text, text, text, date, date, integer, integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_list_events(integer, text, text, text, text, date, date, integer, integer, text, integer) TO service_role;
