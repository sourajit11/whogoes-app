-- Real-time + backfill classification infrastructure (Gemini-driven).
-- Mirrors the dirty-queue + drainer shape of the real-time event-role resolver
-- (20260628121000), but the classify step is an LLM so the drainer lives in n8n,
-- not pg_cron. A trigger enqueues a contact whenever its title/headline/company
-- changes; an n8n workflow claims batches, calls Gemini, and writes buckets back.
--
-- Scope of writes:
--   * contacts.function_bucket / seniority_bucket / classification_confidence  (Gemini)
--   * companies.industry_bucket  (Gemini fallback, only when raw industry is absent)
--   * event_contact_facts.{seniority,func,industry,sizeb,company_name}  (propagated)
-- Size stays enrichment-derived (headcount); not classifiable from text.

-- ---------------------------------------------------------------------------
-- Queue
-- ---------------------------------------------------------------------------
create table if not exists public.classification_queue (
  contact_id   uuid primary key references public.contacts(id) on delete cascade,
  enqueued_at  timestamptz not null default now(),
  claimed_at   timestamptz,
  reason       text
);
alter table public.classification_queue enable row level security;
-- No policies: service role bypasses RLS; anon/authenticated get no access.

create index if not exists idx_classification_queue_claim
  on public.classification_queue (enqueued_at)
  where claimed_at is null;

-- ---------------------------------------------------------------------------
-- Enqueue trigger (title / headline / company change => needs (re)classify)
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_contact_classification()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.classification_queue (contact_id, reason)
  values (new.id, tg_op)
  on conflict (contact_id) do update
    set enqueued_at = now(), claimed_at = null, reason = excluded.reason;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_contact_classification_ins on public.contacts;
create trigger trg_enqueue_contact_classification_ins
  after insert on public.contacts
  for each row execute function public.enqueue_contact_classification();

-- UPDATE OF cannot be combined with a WHEN that reads other columns + a column
-- list cleanly across PG versions, so the column list scopes the fire and the
-- WHEN guards against no-op updates to those columns.
drop trigger if exists trg_enqueue_contact_classification_upd on public.contacts;
create trigger trg_enqueue_contact_classification_upd
  after update of current_title, headline, current_company_id on public.contacts
  for each row
  when (new.current_title       is distinct from old.current_title
     or new.headline            is distinct from old.headline
     or new.current_company_id  is distinct from old.current_company_id)
  execute function public.enqueue_contact_classification();

-- ---------------------------------------------------------------------------
-- Claim a batch (SKIP LOCKED + stale-claim recovery, mirrors qualification loop)
-- ---------------------------------------------------------------------------
create or replace function public.claim_contacts_for_classification(p_max int default 50)
returns table (
  contact_id              uuid,
  current_title           text,
  headline                text,
  company_id              uuid,
  company_name            text,
  company_domain          text,
  company_raw_industry    text,
  company_industry_bucket text
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return query
  with claimed as (
    select q.contact_id
    from public.classification_queue q
    where q.claimed_at is null
       or q.claimed_at < now() - interval '30 minutes'
    order by q.enqueued_at
    for update skip locked
    limit p_max
  ), upd as (
    update public.classification_queue q
    set claimed_at = now()
    from claimed
    where q.contact_id = claimed.contact_id
    returning q.contact_id
  )
  select c.id, c.current_title, c.headline,
         co.id, co.name, co.domain, co.industry, co.industry_bucket
  from upd
  join public.contacts c  on c.id = upd.contact_id
  left join public.companies co on co.id = c.current_company_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Targeted facts refresh for one contact (cheap: updates only its rows)
-- ---------------------------------------------------------------------------
create or replace function public.refresh_contact_facts(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.event_contact_facts f
  set seniority    = c.seniority_bucket,
      func         = c.function_bucket,
      industry     = co.industry_bucket,
      sizeb        = co.size_bucket,
      company_name = co.name
  from public.contacts c
  left join public.companies co on co.id = c.current_company_id
  where f.contact_id = p_contact_id
    and c.id = p_contact_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Write contact classification + propagate + dequeue
-- ---------------------------------------------------------------------------
create or replace function public.set_contact_classification(
  p_contact_id uuid,
  p_function   text,
  p_seniority  text,
  p_confidence text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.contacts
  set function_bucket           = p_function,
      seniority_bucket          = p_seniority,
      classification_confidence = p_confidence
  where id = p_contact_id;

  perform public.refresh_contact_facts(p_contact_id);

  delete from public.classification_queue where contact_id = p_contact_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Write company industry bucket (Gemini fallback) + propagate to facts
-- ---------------------------------------------------------------------------
create or replace function public.set_company_industry_bucket(
  p_company_id uuid,
  p_bucket     text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.companies set industry_bucket = p_bucket where id = p_company_id;

  update public.event_contact_facts f
  set industry = p_bucket
  from public.contacts c
  where c.current_company_id = p_company_id
    and f.contact_id = c.id;
end;
$$;
