-- Phase 0b of pre-unlock filtering: event-role tagging.
--
-- Models what a company/person is DOING at a given event so customers can
-- filter (and exclude) by it. Two grains:
--   1. Company-level role per event  -> company_event_roles (Organizer/Sponsor/
--      Exhibitor/Attendee). The role filter reads this; contacts inherit their
--      company's role for the event.
--   2. Per-contact Speaker flag       -> contact_events.is_speaker.
--
-- The raw per-post extraction (what each post claimed) lands on `posts` and is
-- aggregated into company_event_roles by the resolution step (Phase 1) using the
-- "highest credible rank wins" rule, with source guardrails: mentions and bare
-- reposts can only ever contribute Attendee; only first-person post_author / the
-- company page can establish Exhibitor/Sponsor/Organizer.
--
-- All populated OUT-OF-BAND (qualifying agent for new posts + resolution/backfill
-- for existing). Columns nullable / safe-defaulted; this migration is additive
-- and reversible.

-- The host/organizer of an event (e.g. Amazon for "AWS Public Sector Summit").
-- Nullable: generic events (CES, Cannes) have no single organizer in the
-- attendee pool. Auto-suggested by brand match, human-confirmable. This is the
-- source of truth for the Organizer role; the resolution step also writes an
-- Organizer row into company_event_roles so the role filter stays uniform.
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS organizer_company_id uuid REFERENCES companies(id),
  ADD COLUMN IF NOT EXISTS organizer_confidence text;

CREATE INDEX IF NOT EXISTS idx_events_organizer_company ON events (organizer_company_id);

-- Per-contact: true when the contact's OWN qualified post shows they are
-- speaking ("my session", "keynote", "panel", "I'm speaking at"). Speaker is a
-- person attribute, not a company role. Constant default = no table rewrite.
ALTER TABLE contact_events
  ADD COLUMN IF NOT EXISTS is_speaker boolean NOT NULL DEFAULT false;

-- Speakers are rare; a partial index keeps "speakers at this event" fast and tiny.
CREATE INDEX IF NOT EXISTS idx_contact_events_speaker
  ON contact_events (event_id) WHERE is_speaker;

-- Raw per-post role extraction (emitted by the qualifying agent, content-first).
--   extracted_event_role: organizer | sponsor | exhibitor | attendee | unknown
--   role_is_speaker:      this author is speaking
--   role_evidence:        the quoted snippet that justified the role (for trust UI + audit)
--   role_confidence:      high | medium | low
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS extracted_event_role text,
  ADD COLUMN IF NOT EXISTS role_is_speaker boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS role_evidence text,
  ADD COLUMN IF NOT EXISTS role_confidence text;

-- Resolved company role per event: one row per (event, company).
--   role:        organizer | sponsor | exhibitor | attendee
--   confidence:  confirmed | likely  (mainly distinguishes hard claims from soft
--                reposts/mentions at the Attendee rung)
--   evidence_post_id: the post that won the role, for the trust UI + audit
CREATE TABLE IF NOT EXISTS company_event_roles (
  event_id          uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role              text NOT NULL,
  confidence        text,
  evidence_post_id  uuid REFERENCES posts(id) ON DELETE SET NULL,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, company_id)
);

-- Filter path: "companies with role R at event E" and role facet aggregation.
CREATE INDEX IF NOT EXISTS idx_company_event_roles_event_role
  ON company_event_roles (event_id, role);
-- Reverse lookup: a company's roles across events (future cross-event ICP).
CREATE INDEX IF NOT EXISTS idx_company_event_roles_company
  ON company_event_roles (company_id);

-- Accessed only through SECURITY DEFINER RPCs (facets/unlock), never queried
-- directly by anon/authenticated clients. Enable RLS with no public policy so it
-- is denied by default (satisfies the security advisor and keeps it locked).
ALTER TABLE company_event_roles ENABLE ROW LEVEL SECURITY;
