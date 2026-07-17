-- Pulled from remote on 2026-05-15. Originally applied via Supabase Studio.
-- Captured into local migrations for parity (rule: all DDL must be tracked).


-- Step 1a: Delete outreach_campaigns referencing company URL contacts
DELETE FROM public.outreach_campaigns
WHERE contact_id IN (
  SELECT id FROM public.contacts 
  WHERE linkedin_url LIKE '%/company/%'
);

-- Step 1b: Delete contact_emails referencing company URL contacts
DELETE FROM public.contact_emails
WHERE contact_id IN (
  SELECT id FROM public.contacts 
  WHERE linkedin_url LIKE '%/company/%'
);

-- Step 1c: Delete contact_events referencing company URL contacts
DELETE FROM public.contact_events
WHERE contact_id IN (
  SELECT id FROM public.contacts 
  WHERE linkedin_url LIKE '%/company/%'
);

-- Step 1d: Null out posts.contact_id references (0 expected, safety)
UPDATE public.posts
SET contact_id = NULL
WHERE contact_id IN (
  SELECT id FROM public.contacts 
  WHERE linkedin_url LIKE '%/company/%'
);

-- Step 1e: Null out post_mentions.contact_id references (0 expected, safety)
UPDATE public.post_mentions
SET contact_id = NULL
WHERE contact_id IN (
  SELECT id FROM public.contacts 
  WHERE linkedin_url LIKE '%/company/%'
);

-- Step 1f: Delete the bad contacts themselves
DELETE FROM public.contacts
WHERE linkedin_url LIKE '%/company/%';
