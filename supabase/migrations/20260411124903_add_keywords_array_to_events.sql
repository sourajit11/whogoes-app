-- Pulled from remote on 2026-05-15. Originally applied via Supabase Studio.
-- Captured into local migrations for parity (rule: all DDL must be tracked).


-- Add keywords array column to events table
ALTER TABLE events ADD COLUMN keywords text[] DEFAULT '{}';

-- Migrate existing keyword values into the array
UPDATE events SET keywords = ARRAY[keyword] WHERE keyword IS NOT NULL;
