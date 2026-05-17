-- Add a single-select `industry` column to events so the public Browse Events
-- page can offer an industry filter. Values are populated by a one-time
-- categorization script (`app/scripts/categorize-events-by-industry.mjs`)
-- that researches each event and picks the most prominent vertical from a
-- fixed 20-bucket taxonomy.
--
-- Column is nullable (events without a categorization yet show up under the
-- "All Industries" default and are excluded when a specific industry is
-- selected). Backfilling is done out-of-band by the script, not in this
-- migration, so it stays cheap and reversible.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS industry text;

-- Filter selectivity is moderate (20 buckets across ~623 rows) but the column
-- is also used in the WHERE of `get_all_browsable_events`. A plain btree
-- index keeps the planner honest as the table grows.
CREATE INDEX IF NOT EXISTS events_industry_idx ON events (industry);
