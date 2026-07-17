-- Add a `source` column to companies so imported batches (e.g. Apollo account
-- exports) can be filtered later. NULL = organic pipeline company (event
-- attendee / enrichment); 'apollo' = imported from an Apollo accounts export.
--
-- DDL applied manually via Supabase Studio (project ref citrznhubxqvsfhjkssg);
-- captured here for parity per the "all DDL is tracked" rule. `db push` stays
-- blocked by pre-existing drift, so this file is the record, not the applier.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS source text;

-- Partial index: only tagged rows, so "give me all apollo companies" is fast
-- without bloating the index with the ~98k NULL organic rows.
CREATE INDEX IF NOT EXISTS idx_companies_source
  ON companies (source) WHERE source IS NOT NULL;
