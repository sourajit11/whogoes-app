-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
create or replace function public.sdr_bdr_next_companies(p_limit int default 200)
returns table(company_id uuid, company_name text, website text,
              event_id uuid, event_name text, timing text)
language sql as $$
  with comp as (
    select co.id as company_id, co.name as company_name, co.website,
           qe.id as event_id, qe.name as event_name, qe.timing,
           (h.company_id is not null) as is_host,
           count(*) over (partition by co.id, qe.id) as co_event_contacts,
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
  order by (c.timing = 'upcoming') desc, c.co_event_contacts desc, c.company_name
  limit p_limit;
$$;
