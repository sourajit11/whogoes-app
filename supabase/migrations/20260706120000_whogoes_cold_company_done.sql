-- WhoGoes cold-outreach: company-level processed ledger.
-- Records every company the daily Apollo cold pipeline has attempted (even 0-yield
-- ones) so it is never re-selected. Mirrors sdr_bdr_company_done: no triggers, RLS on,
-- zero coupling to the event/product pipeline. See WHOGOES_COLD_OUTREACH_PIPELINE_PLAN.md.

create table if not exists public.whogoes_cold_company_done (
  company_id    uuid primary key,          -- logical ref to companies(id); no FK (ops table)
  people_found  int  not null default 0,
  people_sent   int  not null default 0,
  processed_at  timestamptz not null default now()
);

alter table public.whogoes_cold_company_done enable row level security;
