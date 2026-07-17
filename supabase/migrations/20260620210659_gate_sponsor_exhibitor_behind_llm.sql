-- Precision change: the deterministic content scan (regex) over-tags Sponsor/Exhibitor on
-- non-trade-show events (e.g. Cannes: "sponsor" is ambient ad-industry vocab, exhibitors use
-- cabana/villa not booth). Regex matches words, not intent. So the deterministic pass now assigns
-- only Attendee (baseline) + Organizer (via events.organizer_company_id). Sponsor/Exhibitor come
-- ONLY from posts.extracted_event_role (the Phase-2 LLM, which reads intent). The COALESCE keeps
-- the LLM answer authoritative when present; source-class ceiling still clamps bare reposts/mentions.
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
      p.author_type, p.post_type, p.extracted_event_role,
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
      -- LLM role (intent-read) when present; else deterministic baseline = attendee only.
      coalesce(
        case lower(extracted_event_role)
          when 'organizer' then 4 when 'sponsor' then 3
          when 'exhibitor' then 2 when 'attendee' then 1 else null end,
        1
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
