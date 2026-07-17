-- Affiliate "Event Insider" recruitment campaign: tracker + suppression list.
--
-- Contacts qualified for affiliate recruitment (solo founders / students attending
-- upcoming events) are inserted here by app/scripts/affiliate-recruit-targets.mjs.
-- The daily contacts->Plusvibe customer pipeline (app/pipeline/lib/contacts.mjs)
-- drops any contact present in this table, so a recruit is never also cold-emailed
-- as a customer lead. contact_id is the primary key: one campaign membership per
-- contact, and suppression is per contact across all events.

begin;

create table if not exists public.affiliate_recruit_targets (
  contact_id        uuid primary key references public.contacts(id) on delete cascade,
  event_id          uuid not null references public.events(id) on delete cascade,
  channel           text not null check (channel in ('linkedin', 'email')),
  segment           text not null check (segment in ('founder_exhibitor', 'founder_attendee', 'student')),
  status            text not null default 'targeted'
                    check (status in ('targeted', 'connected', 'dm_sent', 'emailed', 'applied', 'approved', 'declined')),
  qualified_at      timestamptz not null default now(),
  status_updated_at timestamptz not null default now()
);

comment on table public.affiliate_recruit_targets is
  'Affiliate recruitment campaign targets. Doubles as the suppression list that keeps these contacts out of the daily customer Plusvibe pipeline.';

create index if not exists idx_art_event on public.affiliate_recruit_targets (event_id);
create index if not exists idx_art_status on public.affiliate_recruit_targets (status);

-- Service-role only (targets script + pipeline use the service key). No anon/authenticated access.
alter table public.affiliate_recruit_targets enable row level security;

commit;
