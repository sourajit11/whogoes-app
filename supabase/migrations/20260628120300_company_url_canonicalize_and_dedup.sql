-- Canonicalize LinkedIn company URLs to https://www. and merge www/no-www duplicate
-- company rows. Root cause: normalize_linkedin_company_url() did not touch the www
-- prefix or protocol, so Moltsets (which returns no-www URLs) created duplicate
-- company rows alongside the existing www rows (Apify/DB convention). The Moltsets
-- workflows already emit www-canonical URLs; this migration (1) merges the existing
-- 18 duplicate groups and (2) hardens the normalizer so any future no-www input
-- resolves to the same row. Runs atomically.

-- ---- 1. MERGE duplicate groups (key = URL stripped of protocol + www) ----
CREATE TEMP TABLE _merge ON COMMIT DROP AS
WITH k AS (
  SELECT id, is_enriched, employee_count, created_at,
         lower(regexp_replace(normalized_linkedin_url, '^https?://(www\.)?', '')) AS stripped
  FROM companies WHERE normalized_linkedin_url IS NOT NULL
),
grp AS (SELECT stripped FROM k GROUP BY stripped HAVING count(*) > 1),
ranked AS (
  SELECT k.*, row_number() OVER (
    PARTITION BY k.stripped
    ORDER BY k.is_enriched DESC, k.employee_count DESC NULLS LAST, k.created_at ASC
  ) AS rn
  FROM k JOIN grp USING (stripped)
)
SELECT l.id AS loser_id, s.id AS survivor_id
FROM ranked l
JOIN ranked s ON s.stripped = l.stripped AND s.rn = 1
WHERE l.rn > 1;

-- Fill any survivor gaps from the loser before repointing.
UPDATE companies s SET
  is_enriched    = s.is_enriched OR l.is_enriched,
  employee_count = coalesce(s.employee_count, l.employee_count),
  size_range     = coalesce(s.size_range, l.size_range),
  industry       = coalesce(s.industry, l.industry),
  domain         = coalesce(s.domain, l.domain),
  website        = coalesce(s.website, l.website)
FROM _merge m JOIN companies l ON l.id = m.loser_id
WHERE s.id = m.survivor_id;

-- Repoint the 6 foreign keys loser -> survivor.
UPDATE posts p          SET company_id = m.survivor_id          FROM _merge m WHERE p.company_id = m.loser_id;
UPDATE contacts c       SET current_company_id = m.survivor_id  FROM _merge m WHERE c.current_company_id = m.loser_id;
UPDATE contact_emails e SET company_id = m.survivor_id          FROM _merge m WHERE e.company_id = m.loser_id;
UPDATE shootday_partners_discovery.organizers o SET company_id = m.survivor_id FROM _merge m WHERE o.company_id = m.loser_id;
UPDATE events ev        SET organizer_company_id = m.survivor_id FROM _merge m WHERE ev.organizer_company_id = m.loser_id;
-- company_event_roles has PK (event_id, company_id): move only where survivor has no row for that event.
UPDATE company_event_roles cer SET company_id = m.survivor_id
FROM _merge m
WHERE cer.company_id = m.loser_id
  AND NOT EXISTS (SELECT 1 FROM company_event_roles x
                  WHERE x.event_id = cer.event_id AND x.company_id = m.survivor_id);

-- Delete losers (any leftover company_event_roles rows cascade away).
DELETE FROM companies WHERE id IN (SELECT loser_id FROM _merge);

-- ---- 2. HARDEN the normalizer: force https + www (keeps existing suffix/query cleanup) ----
CREATE OR REPLACE FUNCTION public.normalize_linkedin_company_url(url text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(url, '/+$', ''),
          '/(posts|about|jobs|people|life|videos|events)/?$', ''
        ),
        '\?.*$', ''
      ),
      '^https?://(www\.)?', 'https://www.'
    ),
    '', ''
  )
$function$;

-- ---- 3. Targeted recompute: only rows whose stored normalized value is not yet
--         https://www. (no-www or http). Generated column recomputes on row update.
--         Post-merge these are singletons, so no unique-constraint collision. ----
UPDATE companies
SET linkedin_url = linkedin_url
WHERE normalized_linkedin_url !~ '^https://www\.';
