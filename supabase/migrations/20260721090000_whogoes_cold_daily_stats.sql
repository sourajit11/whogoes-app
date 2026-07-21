-- Daily aggregate for the cold-outreach Slack report.
-- The report route previously pulled raw whogoes_cold_company_done rows and bucketed
-- them in JS. Once the table exceeded ~1000 rows per 2 days, PostgREST's default row cap
-- silently truncated the result to the OLDEST 1000 rows, so today's rows were dropped and
-- the report cried a false "Moltsets outage" (0/0/0) every day. Aggregating in the DB
-- returns one row per IST day (~8 rows), immune to row count.
create or replace function public.get_whogoes_cold_daily_stats(p_days integer default 8)
returns table (ist_day date, companies integer, found integer, sent integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    (processed_at at time zone 'Asia/Kolkata')::date as ist_day,
    count(*)::int as companies,
    coalesce(sum(people_found), 0)::int as found,
    coalesce(sum(people_sent), 0)::int as sent
  from public.whogoes_cold_company_done
  where processed_at >= now() - make_interval(days => p_days)
  group by 1
  order by 1 desc
$$;

-- Called only server-side via the admin (service_role) client.
grant execute on function public.get_whogoes_cold_daily_stats(integer) to service_role;
