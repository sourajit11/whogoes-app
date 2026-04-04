-- Pipeline state tracking for daily lead extraction
-- Stores watermark per event for init vs incremental detection

CREATE TABLE IF NOT EXISTS pipeline_state (
  event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  first_extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_contacts_extracted INTEGER NOT NULL DEFAULT 0,
  last_contact_created_at TIMESTAMPTZ
);

ALTER TABLE pipeline_state ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE pipeline_state IS
  'Tracks which events have been extracted by the daily lead pipeline. Used for init vs incremental detection.';
