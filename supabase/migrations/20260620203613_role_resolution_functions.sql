-- Event-role resolution: aggregate per-post claims into one resolved role per (event, company).
-- Ladder organizer(4) > sponsor(3) > exhibitor(2) > attendee(1). Highest credible claim wins.
-- Guardrails: bare reposts/mentions never elevate past Attendee; only first-person person posts
-- reach Sponsor, only company-page posts reach Organizer. "Content beats source_type": role text
-- is read from post content. Forward-compatible: posts.extracted_event_role (Phase-2 LLM) overrides
-- the deterministic content scan when present. Organizer is set via events.organizer_company_id.

create or replace function public.resolve_company_event_roles(
  p_event_id uuid,
  p_write boolean default false
)
returns table(company_id uuid, role text, confidence text, evidence_post_id uuid, n_posts integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organizer_company_id into v_org from events where id = p_event_id;

  create temporary table _resolved on commit drop as
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
    select distinct on (cid)
      cid, post_id as ev_post, rrank, conf, cid_posts
    from claims
    order by cid, rrank desc, (conf = 'confirmed') desc, posted_at desc nulls last
  )
  select
    b.cid as company_id,
    case when b.cid = v_org or b.rrank = 4 then 'organizer'
         when b.rrank = 3 then 'sponsor'
         when b.rrank = 2 then 'exhibitor'
         else 'attendee' end as role,
    case when b.cid = v_org then 'confirmed' else b.conf end as confidence,
    b.ev_post as evidence_post_id,
    b.cid_posts::int as n_posts
  from best b;

  if p_write then
    delete from company_event_roles where event_id = p_event_id;
    insert into company_event_roles (event_id, company_id, role, confidence, evidence_post_id, computed_at)
    select p_event_id, r.company_id, r.role, r.confidence, r.evidence_post_id, now()
    from _resolved r;
  end if;

  return query select r.company_id, r.role, r.confidence, r.evidence_post_id, r.n_posts from _resolved r;
end;
$$;

-- Organizer brand-match suggestion (read-only). Tokenizes the event name and finds attendee
-- companies whose normalized name contains a distinctive brand token. Suggestion only; a human
-- confirms by setting events.organizer_company_id. Empty for generic events (CES, Cannes).
create or replace function public.suggest_event_organizer(p_event_id uuid)
returns table(company_id uuid, company_name text, match_token text, attendee_posts integer)
language sql
security definer
set search_path = public
as $$
  with ev as (select id, name from events where id = p_event_id),
  toks as (
    select distinct lower(t) as tok
    from ev, regexp_split_to_table(ev.name, '[^A-Za-z0-9]+') as t
    where length(t) >= 3
      and lower(t) not in ('the','and','for','summit','expo','conference','conf','forum','show',
        'public','sector','world','global','international','annual','event','events','fair',
        'congress','convention','meeting','festival','week','days','live','tour','series','north',
        'america','europe','asia','national','tech','technology','digital','online','virtual')
  ),
  att as (
    select distinct coalesce(p.company_id, c.current_company_id) as cid
    from posts p
    left join contacts c on c.id = p.contact_id
    where p.event_id = p_event_id
      and p.post_type is not null and p.post_type not like '%rejected%'
  )
  select co.id, co.name, t.tok,
    (select count(*) from posts p
       left join contacts c on c.id = p.contact_id
       where p.event_id = p_event_id
         and coalesce(p.company_id, c.current_company_id) = co.id
         and coalesce(p.post_type,'') not like '%rejected%')::int as attendee_posts
  from att
  join companies co on co.id = att.cid
  join toks t on co.normalized_name ~* ('\m' || t.tok)
  order by length(t.tok) desc, co.name;
$$;

revoke all on function public.resolve_company_event_roles(uuid, boolean) from public;
revoke all on function public.suggest_event_organizer(uuid) from public;
grant execute on function public.resolve_company_event_roles(uuid, boolean) to service_role;
grant execute on function public.suggest_event_organizer(uuid) to service_role;
