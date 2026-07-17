-- Make role resolution loop-safe (no temp table) and add a daily batch wrapper + pg_cron schedule.
-- Pure calc helper, reused by both the single-event writer and the batch runner.
create or replace function public._resolve_event_roles_calc(p_event_id uuid)
returns table(company_id uuid, role text, confidence text, evidence_post_id uuid, n_posts integer)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select p.id as post_id, p.posted_at,
      coalesce(p.company_id, c.current_company_id) as cid,
      p.author_type, p.post_type, p.content,
      p.extracted_event_role,
      cea.source_type as author_src
    from posts p
    left join contacts c on c.id = p.contact_id
    left join contact_events cea
      on cea.post_id = p.id and (cea.contact_id = p.contact_id or p.contact_id is null)
    where p.event_id = p_event_id
      and p.post_type is not null
      and p.post_type not like '%rejected%'
  ),
  classed as (
    select b.*, case
      when author_type = 'company' and coalesce(author_src,'') <> 'repost' then 'company_page'
      when author_type = 'company' and author_src = 'repost' then 'company_repost'
      when author_type = 'person'  and author_src = 'post_author' then 'first_person'
      when author_src = 'repost' then 'repost'
      when author_src = 'mentioned' then 'mention'
      else 'weak' end as src_class
    from base b
  ),
  ranked as (
    select c.*,
      case src_class when 'company_page' then 4 when 'first_person' then 3
                     when 'company_repost' then 2 else 1 end as ceiling,
      coalesce(
        case lower(extracted_event_role)
          when 'organizer' then 4 when 'sponsor' then 3
          when 'exhibitor' then 2 when 'attendee' then 1 else null end,
        case when src_class in ('company_page','company_repost','first_person') then
          case
            when content ~* '\msponsor' then 3
            when content ~* '\m(booth|exhibit|visit us|stop by|come see|come join us at|come chat|find us at|swing by|see us at)' then 2
            else 1 end
          else 1 end
      ) as raw_rank
    from classed c
  ),
  claims as (
    select post_id, cid, src_class, posted_at,
      least(greatest(raw_rank, 1), ceiling) as rrank,
      case when src_class in ('repost','mention','company_repost') then 'likely'
           when post_type in ('third_party_confirmation','brief_mention') then 'likely'
           else 'confirmed' end as conf,
      count(*) over (partition by cid) as cid_posts
    from ranked
    where cid is not null
  ),
  best as (
    select distinct on (cid) cid, post_id as ev_post, rrank, conf, cid_posts
    from claims
    order by cid, rrank desc, (conf = 'confirmed') desc, posted_at desc nulls last
  )
  select
    b.cid,
    case when b.cid = (select organizer_company_id from events where id = p_event_id) or b.rrank = 4 then 'organizer'
         when b.rrank = 3 then 'sponsor'
         when b.rrank = 2 then 'exhibitor'
         else 'attendee' end,
    case when b.cid = (select organizer_company_id from events where id = p_event_id) then 'confirmed' else b.conf end,
    b.ev_post,
    b.cid_posts::int
  from best b;
$$;

-- Thin single-event writer (re-entrant: safe to call in a loop within one transaction).
create or replace function public.resolve_company_event_roles(p_event_id uuid, p_write boolean default false)
returns table(company_id uuid, role text, confidence text, evidence_post_id uuid, n_posts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_write then
    delete from company_event_roles where event_id = p_event_id;
    insert into company_event_roles (event_id, company_id, role, confidence, evidence_post_id, computed_at)
    select p_event_id, x.company_id, x.role, x.confidence, x.evidence_post_id, now()
    from public._resolve_event_roles_calc(p_event_id) x;
  end if;
  return query select * from public._resolve_event_roles_calc(p_event_id);
end;
$$;

-- Daily batch runner. Resolves active events that are new (no roles yet) or have qualified posts
-- touched within p_days. Pass p_days => null to force-resolve every active event (Phase-4 backfill).
create or replace function public.resolve_active_event_roles(p_days integer default 3)
returns table(events_processed integer, companies_written integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event uuid;
  v_events int := 0;
  v_rows int := 0;
  v_cnt int;
begin
  for v_event in
    select e.id
    from events e
    where e.is_active = true
      and exists (select 1 from posts p
                  where p.event_id = e.id and coalesce(p.post_type,'') not like '%rejected%')
      and (
        p_days is null
        or not exists (select 1 from company_event_roles c where c.event_id = e.id)
        or exists (select 1 from posts p
                   where p.event_id = e.id
                     and coalesce(p.post_type,'') not like '%rejected%'
                     and coalesce(p.updated_at, p.created_at) >= now() - make_interval(days => p_days))
      )
  loop
    select count(*) into v_cnt from public.resolve_company_event_roles(v_event, true);
    v_events := v_events + 1;
    v_rows := v_rows + coalesce(v_cnt, 0);
  end loop;
  return query select v_events, v_rows;
end;
$$;

revoke all on function public._resolve_event_roles_calc(uuid) from public;
revoke all on function public.resolve_active_event_roles(integer) from public;
grant execute on function public._resolve_event_roles_calc(uuid) to service_role;
grant execute on function public.resolve_active_event_roles(integer) to service_role;

-- Daily at 02:30 UTC (08:00 IST), after the daily enrichment window. Incremental (last 3 days).
select cron.schedule(
  'resolve-event-roles-daily',
  '30 2 * * *',
  $cron$ select public.resolve_active_event_roles(3); $cron$
);
