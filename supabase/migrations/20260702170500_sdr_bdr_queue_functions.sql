-- SDR/BDR campaign — queue + host-exclusion logic (heavy SQL kept in the DB).

-- Unique key so host refresh is idempotent.
create unique index if not exists uq_sdr_bdr_host_excluded
  on public.sdr_bdr_host_excluded(event_id, company_id);

-- Window events: target industries, >=200 tracked contacts, past<=45d or upcoming<=6wk.
create or replace view public.v_sdr_bdr_qualifying_events as
select e.id, e.name, e.industry, e.start_date, e.organizer_company_id,
  case when e.start_date >= current_date then 'upcoming' else 'past' end as timing
from public.events e
where e.industry in ('Technology & SaaS','Marketing, Sales & MarTech','AI & Data','Cybersecurity','Finance & FinTech')
  and ((e.start_date >= current_date and e.start_date <= current_date + 42)
    or (e.start_date <  current_date and e.start_date >= current_date - 45))
  and (select count(distinct ce.contact_id) from public.contact_events ce where ce.event_id = e.id) >= 200;

-- Refresh host/organizer exclusions for the current window:
--  organizer field, role=organizer, and dominance (top company by post share >= 10%).
create or replace function public.sdr_bdr_refresh_hosts()
returns int language plpgsql as $$
declare n int;
begin
  insert into public.sdr_bdr_host_excluded(event_id, company_id, reason)
  select event_id, company_id, reason from (
    select qe.id as event_id, qe.organizer_company_id as company_id, 'organizer_field' as reason
      from public.v_sdr_bdr_qualifying_events qe
      where qe.organizer_company_id is not null
    union
    select cer.event_id, cer.company_id, 'organizer_role'
      from public.company_event_roles cer
      join public.v_sdr_bdr_qualifying_events qe on qe.id = cer.event_id
      where cer.role = 'organizer'
    union
    select event_id, company_id, 'dominance' from (
      select ce.event_id, ct.current_company_id as company_id,
        count(*) as c,
        sum(count(*)) over (partition by ce.event_id) as tot,
        row_number() over (partition by ce.event_id order by count(*) desc) as rn
      from public.contact_events ce
      join public.contacts ct on ct.id = ce.contact_id
      join public.v_sdr_bdr_qualifying_events qe on qe.id = ce.event_id
      where ct.current_company_id is not null
      group by ce.event_id, ct.current_company_id
    ) d
    where d.rn = 1 and (d.c::numeric / nullif(d.tot,0)) >= 0.10
  ) x
  where x.company_id is not null
  on conflict (event_id, company_id) do nothing;
  get diagnostics n = row_count;
  return n;
end$$;

-- Next companies to process: one chosen event per company (prefer non-host, then upcoming,
-- then most recent), excluding already-done and host companies.
create or replace function public.sdr_bdr_next_companies(p_limit int default 200)
returns table(company_id uuid, company_name text, website text,
              event_id uuid, event_name text, timing text)
language sql as $$
  with comp as (
    select co.id as company_id, co.name as company_name, co.website,
           qe.id as event_id, qe.name as event_name, qe.timing,
           (h.company_id is not null) as is_host,
           row_number() over (
             partition by co.id
             order by (h.company_id is not null) asc,
                      (qe.timing = 'upcoming') desc,
                      qe.start_date desc
           ) as rn
    from public.v_sdr_bdr_qualifying_events qe
    join public.contact_events ce on ce.event_id = qe.id
    join public.contacts ct on ct.id = ce.contact_id
    join public.companies co on co.id = ct.current_company_id
    left join public.sdr_bdr_host_excluded h on h.company_id = co.id and h.event_id = qe.id
    where coalesce(co.website,'') <> ''
  )
  select c.company_id, c.company_name, c.website, c.event_id, c.event_name, c.timing
  from comp c
  where c.rn = 1 and not c.is_host
    and not exists (select 1 from public.sdr_bdr_company_done d where d.company_id = c.company_id)
  order by (c.timing = 'upcoming') desc, c.company_name
  limit p_limit;
$$;
