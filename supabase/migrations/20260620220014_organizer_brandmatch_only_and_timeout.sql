-- Two fixes:
-- 1) The LLM cannot reliably establish Organizer (it tagged speakers, yacht-hosts, and a person
--    who interned at the festival as "organizer"). Organizer is set ONLY by the brand-match
--    override (events.organizer_company_id). So an LLM 'organizer' label is treated as Attendee.
-- 2) Raise statement_timeout inside the functions so the RPC/PostgREST path does not time out on
--    big events (Cannes ~6.5k posts / 3.4k companies). pg_cron is unaffected, but the ingest
--    script's .rpc() call was hitting the per-request timeout.
create or replace function public._resolve_event_roles_calc(p_event_id uuid)
returns table(company_id uuid, role text, confidence text, evidence_post_id uuid, n_posts integer)
language sql
stable
security definer
set search_path = public
set statement_timeout = '180s'
as $$
  with base as (
    select p.id as post_id, p.posted_at,
      coalesce(p.company_id, c.current_company_id) as cid,
      p.author_type, p.post_type, p.extracted_event_role, p.role_confidence,
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
      -- LLM role (intent) when present, else attendee baseline. 'organizer' is NOT trusted from a
      -- post: it falls to attendee, leaving brand-match (events.organizer_company_id) the only
      -- source of Organizer.
      coalesce(
        case lower(extracted_event_role)
          when 'sponsor' then 3 when 'exhibitor' then 2
          when 'attendee' then 1 when 'organizer' then 1 else null end,
        1
      ) as raw_rank,
      case
        when extracted_event_role is not null
          then case when lower(role_confidence) in ('high','medium') then 'confirmed' else 'likely' end
        when src_class in ('repost','mention','company_repost') then 'likely'
        when post_type in ('third_party_confirmation','brief_mention') then 'likely'
        else 'confirmed' end as conf
    from classed c
  ),
  claims as (
    select post_id, cid, posted_at, raw_rank as rrank, conf,
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
    case when b.cid = (select organizer_company_id from events where id = p_event_id) then 'organizer'
         when b.rrank = 3 then 'sponsor'
         when b.rrank = 2 then 'exhibitor'
         else 'attendee' end,
    case when b.cid = (select organizer_company_id from events where id = p_event_id) then 'confirmed' else b.conf end,
    b.ev_post,
    b.cid_posts::int
  from best b;
$$;

alter function public.resolve_company_event_roles(uuid, boolean) set statement_timeout = '180s';
alter function public.resolve_active_event_roles(integer) set statement_timeout = '300s';
