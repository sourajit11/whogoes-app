-- Pulled from remote on 2026-05-15. Originally applied via Supabase Studio.
-- Captured into local migrations for parity (rule: all DDL must be tracked).


ALTER TABLE public.contacts
ADD CONSTRAINT contacts_no_company_url
CHECK (linkedin_url NOT LIKE '%/company/%' AND linkedin_url NOT LIKE '%/showcase/%');
