-- Quarantine store for the "tagged-name author false positive" sweeper.
--
-- Background: a post's author is linked to an event as an attendee (contact_events.source_type =
-- 'post_author') whenever the qualifier marks the post Qualified. A recurring false positive slips
-- through when the target event name appears in the post ONLY because a TAGGED person put the event
-- in their own LinkedIn display name using the "coming soon" convention (e.g. "Astrid 🔜Develop
-- Brighton"). The author never claimed attendance; the AI qualified it as a benefit-of-doubt
-- 'brief_mention'. Example: Nissie Arcega falsely tagged as attending Develop:Brighton 2026.
--
-- A separate n8n sweeper (runs every 2h) detects these and moves the offending contact_events row
-- here, then deletes it from contact_events so it disappears from every attendee list / preview /
-- unlock surface. This table is the reversible "soft delete": it is an isolated, additive store and
-- touches NO existing table or read-path query. Restore = re-insert original_row back into
-- contact_events. Only rows with source_type='post_author' are ever swept; 'mentioned' rows (the
-- genuine "🔜 EventName" attendees) are never touched.

create table if not exists public.contact_events_quarantine (
  contact_event_id  uuid primary key,          -- original contact_events.id
  original_row      jsonb not null,            -- full original contact_events row, for lossless restore
  contact_id        uuid,
  event_id          uuid,
  post_id           uuid,
  quarantine_reason text,                       -- why it was swept
  carrier_tag       text,                       -- the mentioned/tagged name that carried the event brand
  event_name        text,
  author_name       text,
  swept_at          timestamptz not null default now()
);

comment on table public.contact_events_quarantine is
  'Soft-deleted post_author contact_events rows removed by the tagged-name false-positive sweeper. Reversible: re-insert original_row into contact_events to restore.';

create index if not exists idx_ce_quarantine_event on public.contact_events_quarantine (event_id);
create index if not exists idx_ce_quarantine_swept_at on public.contact_events_quarantine (swept_at desc);

-- Service-role only (the sweeper uses the service key). No anon/authenticated access.
alter table public.contact_events_quarantine enable row level security;
