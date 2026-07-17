-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
create table if not exists public.sdr_bdr_company_done (
  company_id   uuid primary key,
  reps_sent    int  not null default 0,
  processed_at timestamptz not null default now()
);

create table if not exists public.sdr_bdr_leads_sent (
  linkedin_url  text primary key,
  email         text,
  company_id    uuid,
  event_timing  text,
  ab_arm        text,
  sent_at       timestamptz not null default now()
);
create index if not exists idx_sdr_bdr_leads_sent_company on public.sdr_bdr_leads_sent(company_id);

create table if not exists public.sdr_bdr_host_excluded (
  id          bigint generated always as identity primary key,
  event_id    uuid,
  company_id  uuid,
  reason      text,
  logged_at   timestamptz not null default now()
);
create index if not exists idx_sdr_bdr_host_excluded_event on public.sdr_bdr_host_excluded(event_id);

alter table public.sdr_bdr_company_done  enable row level security;
alter table public.sdr_bdr_leads_sent    enable row level security;
alter table public.sdr_bdr_host_excluded enable row level security;
