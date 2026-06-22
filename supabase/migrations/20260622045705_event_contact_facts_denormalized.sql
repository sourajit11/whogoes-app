-- Filtered ICP queries (facets + preview) were ~3-5s on large events because
-- event_filtered_contact_ids joins contact_events -> contacts -> companies ->
-- company_event_roles row-by-row for every contact in the event (9k+ random lookups),
-- which stays multi-second even fully cached. Denormalize those per-(event,contact)
-- attributes into one table the DISPLAY queries scan directly (single index range +
-- in-memory filter). Refreshed in the same background job as facets_cache.
--
-- The money-critical unlock still uses the LIVE event_filtered_contact_ids so a
-- brand-new contact is never missed; this table only backs read-only display.

CREATE TABLE IF NOT EXISTS public.event_contact_facts (
  event_id     uuid NOT NULL,
  contact_id   uuid NOT NULL,
  created_at   timestamptz,
  has_email    boolean NOT NULL DEFAULT false,
  seniority    text,
  func         text,
  country      text,
  industry     text,
  sizeb        text,
  company_name text,
  role         text NOT NULL DEFAULT 'attendee',
  is_speaker   boolean NOT NULL DEFAULT false,
  title_search text,            -- current_title + headline, for the job-title keyword filter
  PRIMARY KEY (event_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_event_contact_facts_event ON public.event_contact_facts (event_id);

-- No direct client access; only the SECURITY DEFINER functions below read it.
ALTER TABLE public.event_contact_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_contact_facts FROM anon, authenticated;

-- Rebuild one event's denormalized rows from the live source of truth.
CREATE OR REPLACE FUNCTION public.refresh_event_contact_facts(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
BEGIN
  DELETE FROM public.event_contact_facts WHERE event_id = p_event_id;
  INSERT INTO public.event_contact_facts
    (event_id, contact_id, created_at, has_email, seniority, func, country, industry, sizeb, company_name, role, is_speaker, title_search)
  SELECT p_event_id, contact_id, created_at, has_email, seniority, func, country, industry, sizeb, company_name, role, is_speaker, title_search
  FROM (
    SELECT DISTINCT ON (ce.contact_id)
      ce.contact_id,
      ce.created_at,
      c.has_primary_email AS has_email,
      c.seniority_bucket AS seniority, c.function_bucket AS func, c.country AS country,
      co.industry_bucket AS industry, co.size_bucket AS sizeb, co.name AS company_name,
      CASE
        WHEN coalesce(cer.role,'attendee') IN ('organizer','sponsor','exhibitor') THEN cer.role
        WHEN coalesce(ce.is_speaker,false) OR ce.source_type IN ('post_author','mentioned') THEN 'attendee'
        ELSE 'expected_attendee'
      END AS role,
      coalesce(ce.is_speaker,false) AS is_speaker,
      coalesce(c.current_title,'') || ' ' || coalesce(c.headline,'') AS title_search
    FROM contact_events ce
    JOIN contacts c ON c.id = ce.contact_id
    LEFT JOIN companies co ON co.id = c.current_company_id
    LEFT JOIN company_event_roles cer ON cer.event_id = p_event_id AND cer.company_id = c.current_company_id
    WHERE ce.event_id = p_event_id
    ORDER BY ce.contact_id, coalesce(ce.is_speaker,false) DESC,
             (ce.source_type IN ('post_author','mentioned')) DESC, ce.created_at DESC NULLS LAST
  ) sub;
END;
$$;

-- Fast read with the same jsonb filter contract + output columns as
-- event_filtered_contact_ids, but reading the denormalized table (no joins).
CREATE OR REPLACE FUNCTION public.event_filtered_facts(p_event_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE(contact_id uuid, has_email boolean, created_at timestamptz, seniority text, func text, industry text, sizeb text, country text, role text, company_name text, is_speaker boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
  SELECT f.contact_id, f.has_email, f.created_at, f.seniority, f.func, f.industry, f.sizeb, f.country, f.role, f.company_name, f.is_speaker
  FROM public.event_contact_facts f
  WHERE f.event_id = p_event_id
    AND (not (p_filters ? 'seniority') or f.seniority = any(array(select jsonb_array_elements_text(p_filters->'seniority'))))
    AND (not (p_filters ? 'function')  or f.func      = any(array(select jsonb_array_elements_text(p_filters->'function'))))
    AND (not (p_filters ? 'industry')  or f.industry  = any(array(select jsonb_array_elements_text(p_filters->'industry'))))
    AND (not (p_filters ? 'size')      or f.sizeb     = any(array(select jsonb_array_elements_text(p_filters->'size'))))
    AND (not (p_filters ? 'country')   or f.country   = any(array(select jsonb_array_elements_text(p_filters->'country'))))
    AND (not (p_filters ? 'role')      or f.role      = any(array(select jsonb_array_elements_text(p_filters->'role'))))
    AND (not (p_filters ? 'speaker')   or (p_filters->>'speaker')::boolean is not true or f.is_speaker = true)
    AND (not (p_filters ? 'title_keyword') or p_filters->>'title_keyword' = ''
         or f.title_search ilike '%'||(p_filters->>'title_keyword')||'%')
    AND (not (p_filters ? 'company_include') or p_filters->>'company_include' = ''
         or f.company_name ilike '%'||(p_filters->>'company_include')||'%')
    AND (not (p_filters ? 'company_exclude') or p_filters->>'company_exclude' = ''
         or f.company_name is null or f.company_name not ilike '%'||(p_filters->>'company_exclude')||'%');
$$;

GRANT EXECUTE ON FUNCTION public.event_filtered_facts(uuid, jsonb) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.refresh_event_contact_facts(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.refresh_event_contact_facts(uuid) TO service_role;

-- Repoint the DISPLAY facets onto the fast denormalized read.
CREATE OR REPLACE FUNCTION public.get_event_filter_facets(p_event_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
  with m as (select * from public.event_filtered_facts(p_event_id, p_filters))
  select json_build_object(
    'matched',    (select count(*) from m),
    'with_email', (select count(*) from m where has_email),
    'by_seniority', (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select coalesce(seniority,'Unknown') k, count(*) n from m group by 1) s),
    'by_function',  (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select coalesce(func,'Unknown') k, count(*) n from m group by 1) s),
    'by_role',      (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select role k, count(*) n from m group by 1) s),
    'by_industry',  (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select coalesce(industry,'Unknown') k, count(*) n from m group by 1 order by 2 desc limit 30) s),
    'by_size',      (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select coalesce(sizeb,'Unknown') k, count(*) n from m group by 1) s),
    'by_country',   (select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select coalesce(country,'Unknown') k, count(*) n from m group by 1 order by 2 desc limit 15) s),
    'top_companies',(select coalesce(json_agg(json_build_object('key',k,'count',n) order by n desc),'[]'::json)
                     from (select company_name k, count(*) n from m where company_name is not null group by 1 order by 2 desc limit 15) s)
  );
$$;

-- Repoint the DISPLAY preview onto the fast read (the redacted rows come from the table;
-- the single fully-named SAMPLE row is still fetched live by contact_id).
CREATE OR REPLACE FUNCTION public.get_event_filter_preview(
  p_event_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 10
)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '45s'
AS $$
  with m as (select * from public.event_filtered_facts(p_event_id, p_filters)),
  ranked as (
    select *, row_number() over (order by has_email desc, created_at desc nulls last) as rn
    from m
  ),
  s as (select contact_id from ranked where rn = 1)
  select json_build_object(
    'matched', (select count(*) from m),
    'with_email', (select count(*) from m where has_email),
    'sample', (
      select case when s.contact_id is null then null else json_build_object(
        'full_name', c.full_name,
        'current_title', c.current_title,
        'company_name', co.name,
        'company_industry', co.industry,
        'company_size', co.size_range,
        'country', c.country,
        'seniority', c.seniority_bucket,
        'function', c.function_bucket,
        'role', coalesce(cer.role, 'attendee'),
        'is_speaker', coalesce((select bool_or(ce.is_speaker) from contact_events ce
                                where ce.contact_id = c.id and ce.event_id = p_event_id), false),
        'has_email', c.has_primary_email,
        'contact_linkedin_url', c.linkedin_url,
        'post_url', (select p.post_url from contact_events ce join posts p on p.id = ce.post_id
                     where ce.contact_id = c.id and ce.event_id = p_event_id and p.post_url is not null limit 1)
      ) end
      from s
      left join contacts c on c.id = s.contact_id
      left join companies co on co.id = c.current_company_id
      left join company_event_roles cer on cer.event_id = p_event_id and cer.company_id = c.current_company_id
    ),
    'rows', (
      select coalesce(json_agg(json_build_object(
        'seniority', seniority, 'function', func, 'industry', industry, 'size', sizeb,
        'country', country, 'role', role, 'is_speaker', is_speaker, 'has_email', has_email
      ) order by has_email desc), '[]'::json)
      from (select * from ranked where rn between 2 and p_limit + 1) x
    )
  );
$$;

-- Fold the facts refresh into the existing per-event facets refresh so one job keeps both
-- the denormalized table and the unfiltered cache fresh.
CREATE OR REPLACE FUNCTION public.refresh_event_facets(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
BEGIN
  PERFORM public.refresh_event_contact_facts(p_event_id);
  UPDATE public.events
  SET facets_cache = public.get_event_filter_facets(p_event_id, '{}'::jsonb),
      facets_cached_at = now()
  WHERE id = p_event_id;
END;
$$;
