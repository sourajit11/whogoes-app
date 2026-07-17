-- Fix: organizer_company_id did not tag its own attendee contacts unless that company also
-- authored a post in the event.
--
-- _resolve_event_roles_calc builds its company set ONLY from `posts` (cid = company that authored a
-- post, or the current_company_id of a contact who authored a post). Organizer is then assigned only
-- to companies already in that post-derived set. So an organizer that is present purely as passive
-- attendees with no authored post (e.g. SEG, dmg events, messe offenbach) got events.organizer_company_id
-- set + organizer_confidence correct, but never received a company_event_roles 'organizer' row, so
-- refresh_event_contact_facts never flipped its contacts to organizer.
--
-- This replaces the calc so the organizer company is UNIONED into the result even with 0 posts,
-- assigned role='organizer', confidence='confirmed', n_posts=0. Post-derived rows are unchanged;
-- the union only fires when the organizer is not already present, so there is no duplicate cid.
-- Everything else about the resolver (sponsor/exhibitor/attendee ladder, timeouts) is preserved.

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
  ),
  post_derived as (
    select
      b.cid as company_id,
      case when b.cid = (select organizer_company_id from events where id = p_event_id) then 'organizer'
           when b.rrank = 3 then 'sponsor'
           when b.rrank = 2 then 'exhibitor'
           else 'attendee' end as role,
      case when b.cid = (select organizer_company_id from events where id = p_event_id) then 'confirmed' else b.conf end as confidence,
      b.ev_post as evidence_post_id,
      b.cid_posts::int as n_posts
    from best b
  )
  select * from post_derived
  union all
  -- Inject the organizer even when it has no posts, so its attendee contacts flip to organizer.
  select e.organizer_company_id, 'organizer', 'confirmed', null::uuid, 0
  from events e
  where e.id = p_event_id
    and e.organizer_company_id is not null
    and e.organizer_company_id not in (select company_id from post_derived);
$$;

revoke all on function public._resolve_event_roles_calc(uuid) from public;
grant execute on function public._resolve_event_roles_calc(uuid) to service_role;
