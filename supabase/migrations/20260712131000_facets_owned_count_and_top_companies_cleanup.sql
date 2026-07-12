-- Two facets changes:
--
-- 1) `owned`: how many of the matched contacts the calling user has already
--    unlocked for this event. Lets the unlock UI say "201 match, 20 already
--    yours, 181 new" and cap the slider at the truly unlockable count. The
--    unfiltered facets_cache is built by the service role (auth.uid() is null),
--    so cached facets always carry owned = 0; clients must only trust `owned`
--    from live authenticated calls (the UI falls back to unlock-status counts
--    for the unfiltered state).
--
-- 2) top_companies excludes non-company buckets ("self-employed", "freelance")
--    and known extraction artifacts ("Results") that were polluting the trust
--    breakdown on event pages.

CREATE OR REPLACE FUNCTION public.get_event_filter_facets(p_event_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
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
                    and cca.user_id = auth.uid()),
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
