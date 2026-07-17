-- Pulled from remote on 2026-05-15. Originally applied via Supabase Studio.
-- Captured into local migrations for parity (rule: all DDL must be tracked).


-- Drop the old 6-param overload that causes PGRST203 ambiguity
DROP FUNCTION IF EXISTS enrich_company(uuid, text, text, text, text, text);
