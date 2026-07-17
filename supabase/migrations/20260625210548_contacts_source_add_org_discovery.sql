-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
alter table public.contacts drop constraint contacts_source_check;
alter table public.contacts add constraint contacts_source_check
  check (source = any (array['post_author'::text, 'repost'::text, 'mentioned'::text, 'inbound'::text, 'org_discovery'::text]));
