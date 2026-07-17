-- Organizer announcement coverage, part 1 of 2 (additive, no lock risk).
-- See app/docs/ANNOUNCEMENT_SCRAPER_PLAN.md.
--
-- Lets an organizer / host-company page contribute MANY posts for one event
-- (each announcing a different attendee) instead of collapsing to one. The live
-- insert_post_if_new is NOT touched. This part only adds columns + a NEW sibling
-- ingestion RPC. Part 2 (the index swap) is a separate migration.
--
-- Root cause (verified): insert_post_if_new drops posts 2..N via Check 2
-- (duplicate_author_event). post_url is already globally unique
-- (posts_post_url_key), so re-scrape idempotency is already handled and we do NOT
-- add any (event_id, post_url) index.

-- 1. Flag announcement posts. Constant default = fast metadata-only add, no rewrite.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS is_announcement boolean NOT NULL DEFAULT false;

-- 2. Explicit organizer LinkedIn page per event = the announcement scraper's input.
--    Chosen over organizer_company_id (null for most events). Human/tool populated.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS organizer_linkedin_url text;

-- 3. New sibling ingestion RPC. Byte-for-byte insert_post_if_new EXCEPT:
--    - Check 2 (duplicate_author_event) is REMOVED so many posts per author land.
--    - is_announcement = true on insert.
--    Check 1 (global duplicate_url) is kept, so a post is still stored at most once.
CREATE OR REPLACE FUNCTION public.insert_announcement_post(
  p_post_url text,
  p_event_id uuid,
  p_author_linkedin_url text,
  p_author_name text,
  p_content text,
  p_posted_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_status text DEFAULT 'in_process'::text
)
RETURNS json
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
declare
  existing_post record;
  new_post record;
begin
  -- Check 1 ONLY: global post_url dedup (identical to insert_post_if_new).
  select id, post_url, 'duplicate_url' as skip_reason
  into existing_post
  from public.posts
  where post_url = p_post_url;

  if found then
    return json_build_object(
      'post_id', existing_post.id,
      'post_url', existing_post.post_url,
      'inserted', false,
      'skip_reason', 'duplicate_url'
    );
  end if;

  -- Check 2 (duplicate_author_event) intentionally OMITTED for announcements.

  insert into public.posts (
    post_url, event_id, author_linkedin_url, author_name, content, posted_at, status, is_announcement
  )
  values (
    p_post_url, p_event_id, p_author_linkedin_url, p_author_name, p_content, p_posted_at, p_status, true
  )
  returning * into new_post;

  return json_build_object(
    'post_id', new_post.id,
    'post_url', new_post.post_url,
    'inserted', true,
    'skip_reason', null
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.insert_announcement_post(text, uuid, text, text, text, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_announcement_post(text, uuid, text, text, text, timestamptz, text) TO service_role;
