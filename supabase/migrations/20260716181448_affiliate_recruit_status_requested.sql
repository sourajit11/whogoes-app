-- Add 'requested' (connection request sent, awaiting acceptance) to the
-- affiliate recruitment status funnel: targeted -> requested -> connected -> dm_sent -> ...

begin;

alter table public.affiliate_recruit_targets
  drop constraint affiliate_recruit_targets_status_check;

alter table public.affiliate_recruit_targets
  add constraint affiliate_recruit_targets_status_check
  check (status in ('targeted', 'requested', 'connected', 'dm_sent', 'emailed', 'applied', 'approved', 'declined'));

commit;
