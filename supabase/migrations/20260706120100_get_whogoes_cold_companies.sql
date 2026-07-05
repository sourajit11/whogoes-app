-- WhoGoes cold-outreach: daily company selector.
-- Returns the next batch of unprocessed US/CA Apollo companies, IT + Marketing
-- buckets first, then everything else, oldest-first within each tier.
-- Skips companies already in whogoes_cold_company_done. See the plan doc.

create or replace function public.get_whogoes_cold_companies(p_limit int default 500)
returns table (
  id              uuid,
  name            text,
  website         text,
  industry        text,
  industry_bucket text
)
language sql
stable
as $$
  select c.id, c.name, c.website, c.industry, c.industry_bucket
  from public.companies c
  left join public.whogoes_cold_company_done d on d.company_id = c.id
  where c.source = 'apollo'
    and c.website is not null
    and d.company_id is null
  order by
    case
      when c.industry_bucket in ('Software & IT Services',
                                 'Marketing, Advertising & PR') then 0
      else 1
    end,
    c.created_at
  limit greatest(p_limit, 0);
$$;
