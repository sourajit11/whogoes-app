-- WhoGoes cold-outreach prospects — standalone campaign table.
--
-- Deliberately SEPARATE from the event-centric product pipeline
-- (contacts / contact_emails / contact_events / outreach_campaigns): those tables
-- fire classification, role-resolution and enrichment triggers on insert and are
-- scoped through events. These rows are Apollo-sourced sales people we discovered
-- via Moltsets + Dropleads and verified with Reoon, for promoting WhoGoes itself.
-- Storing them here keeps them out of every product trigger/view (zero blast
-- radius), mirroring the SDR/BDR campaign state tables.
--
-- Reuses (read-only) the `companies` table via company_id and the global
-- `email_suppressions` list at send time. No triggers on this table by design.

create table if not exists public.whogoes_prospects (
  id              uuid primary key default gen_random_uuid(),
  linkedin_url    text unique not null,           -- dedupe key
  full_name       text,
  first_name      text,
  last_name       text,
  title           text,
  company_id      uuid,                            -- logical ref to companies(id); no FK (ops table)
  company_name    text,
  company_domain  text,
  industry        text,
  discovered_by   text[] not null default '{}',    -- {moltsets,dropleads}
  email           text,
  email_provider  text,                            -- vendor that returned the winning email
  email_status    text,                            -- reoon power-mode status
  is_contactable  boolean not null default false,  -- reoon safe/valid AND not suppressed
  verified_at     timestamptz,
  campaign_status text not null default 'new',      -- new|queued|sent|replied|bounced|unsubscribed
  instantly_campaign_id text,
  sent_at         timestamptz,
  replied_at      timestamptz,
  source          text not null default 'apollo+moltsets+dropleads',
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_whogoes_prospects_company      on public.whogoes_prospects(company_id);
create index if not exists idx_whogoes_prospects_contactable  on public.whogoes_prospects(is_contactable);
create index if not exists idx_whogoes_prospects_status       on public.whogoes_prospects(campaign_status);
create index if not exists idx_whogoes_prospects_email        on public.whogoes_prospects(email);

-- Internal ops table: enable RLS (service role bypasses it) so no anon access is possible.
alter table public.whogoes_prospects enable row level security;
