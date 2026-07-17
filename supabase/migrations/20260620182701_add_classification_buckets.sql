-- Phase 0a of pre-unlock filtering: normalized classification buckets.
--
-- Adds the columns the filter UI and facet RPCs read. Today the raw fields are
-- unusable for filtering: titles are fragmented ("CEO" vs "Chief Executive
-- Officer" are separate rows), size_range mixes formats ("10001+", "10001-null",
-- raw "2"), and industry mixes two LinkedIn taxonomy versions ("Computer
-- Software" + "Software Development"). These buckets are the clean, filterable
-- layer derived from those raw fields.
--
-- Values are populated OUT-OF-BAND (backfill scripts for existing rows, and the
-- enrichment / qualifying workflows for new rows), never in this migration, so
-- it stays cheap and reversible. All columns are nullable; an unclassified row
-- simply does not match a specific bucket filter.

-- Contact-level: derived from current_title + headline.
--   seniority_bucket: C-Suite | Owner/Founder | VP | Director | Manager | IC
--   function_bucket:  Sales/BD | Marketing | Operations | Finance | Engineering
--                     | Product | IT/Data | HR/People | Legal/Compliance
--                     | Procurement/Supply Chain | Customer Success
--                     | Executive/General Mgmt | Other
--   classification_confidence: high | medium | low (rules vs LLM-fallback origin)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS seniority_bucket text,
  ADD COLUMN IF NOT EXISTS function_bucket text,
  ADD COLUMN IF NOT EXISTS classification_confidence text,
  ADD COLUMN IF NOT EXISTS classified_at timestamptz;

-- Company-level: cleaned from raw size_range/employee_count, and the raw
-- (mixed-taxonomy) industry mapped into ~45 Apollo top-level buckets.
--   size_bucket:     1-10 | 11-50 | 51-200 | 201-500 | 501-1000 | 1001-5000 | 5000+
--   industry_bucket: one of the ~45 Apollo categories (set during enrichment)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS size_bucket text,
  ADD COLUMN IF NOT EXISTS industry_bucket text;

-- Low-cardinality filter columns. Per-event filtering only scans a few hundred
-- to a few thousand contacts (cheap), but these same columns power future
-- cross-event ICP rollups, so index them now while the tables are this size.
CREATE INDEX IF NOT EXISTS idx_contacts_seniority_bucket ON contacts (seniority_bucket);
CREATE INDEX IF NOT EXISTS idx_contacts_function_bucket ON contacts (function_bucket);
CREATE INDEX IF NOT EXISTS idx_companies_industry_bucket ON companies (industry_bucket);
CREATE INDEX IF NOT EXISTS idx_companies_size_bucket ON companies (size_bucket);
