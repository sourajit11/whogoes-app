-- Add company-industry and company-size breakdowns to the facets so the filter UI can offer
-- those axes with per-event counts (industry is a primary prospect ask).
create or replace function public.get_event_filter_facets(p_event_id uuid, p_filters jsonb default '{}'::jsonb)
returns json
language sql
stable
security definer
set search_path = public
set statement_timeout = '60s'
as $$
  with m as (select * from public.event_filtered_contact_ids(p_event_id, p_filters))
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
