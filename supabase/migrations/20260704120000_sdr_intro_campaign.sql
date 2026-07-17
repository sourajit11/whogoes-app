-- SDR/BDR/GTM generic "intro to WhoGoes" campaign (US + Canada), company-anchored.
-- No event anchor: we pull tech/B2B companies from Moltsets search_companies, then
-- search_people per company_domain for US/CA SDR/BDR/GTM reps. Leads are keyed by company
-- DOMAIN (no WhoGoes company_id). Shares sdr_bdr_leads_sent for cross-campaign person dedupe.

-- Pagination cursor per (industry, employee_range) company-sweep bucket, so each daily run
-- continues search_companies paging where the last one stopped.
create table if not exists public.sdr_intro_cursor (
  industry       text not null,
  employee_range text not null,
  next_offset    int  not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (industry, employee_range)
);

-- Ramp anchor (single row). Daily target = min(500, 200 + 25 * days_since(started_on)).
create table if not exists public.sdr_intro_state (
  id         int  primary key default 1,
  started_on date not null default current_date
);

-- Companies already processed (by domain), so we don't re-scan them and waste the search cap.
create table if not exists public.sdr_intro_company_done (
  domain       text primary key,
  sent         int  not null default 0,
  reason       text,            -- 'sent' | 'no_reps' | 'not_google' | 'no_domain'
  processed_at timestamptz not null default now()
);

-- Segment the shared dedupe / daily-cap table by campaign (non-breaking; existing rows = 'event').
-- company_domain lets the intro campaign cap at 2 contacts per company without a company_id.
alter table public.sdr_bdr_leads_sent add column if not exists source         text not null default 'event';
alter table public.sdr_bdr_leads_sent add column if not exists company_domain text;

-- Count queries: today's intro sends (daily cap) and intro sends per company (2-per-company cap).
create index if not exists idx_sdr_bdr_leads_sent_source_sent   on public.sdr_bdr_leads_sent(source, sent_at);
create index if not exists idx_sdr_bdr_leads_sent_source_domain on public.sdr_bdr_leads_sent(source, company_domain);

-- Internal ops tables: enable RLS (service role bypasses) so no anon access is possible.
alter table public.sdr_intro_cursor       enable row level security;
alter table public.sdr_intro_state        enable row level security;
alter table public.sdr_intro_company_done enable row level security;

-- Seed the ramp anchor to today (idempotent).
insert into public.sdr_intro_state (id, started_on)
values (1, current_date)
on conflict (id) do nothing;
