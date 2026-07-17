-- Backfilled from remote schema_migrations on 2026-07-15 (drift recovery).
-- Phase 2 Qualification: atomic claim + self-healing reaper.

-- 1. Allow the new transient status.
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE public.posts ADD CONSTRAINT posts_status_check
  CHECK (status = ANY (ARRAY['new'::text, 'in_process'::text, 'qualifying'::text, 'qualified'::text, 'done'::text]));

-- 2. Track when a row was claimed, so the reaper can release stuck claims.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- 3. Keep the claim scan tiny against 200k+ done rows.
CREATE INDEX IF NOT EXISTS idx_posts_claimable
  ON public.posts (created_at)
  WHERE status IN ('in_process', 'qualifying');

-- 4. The claim function (reaper + atomic claim in one call).
CREATE OR REPLACE FUNCTION public.claim_posts_for_qualification(p_limit integer DEFAULT 200)
RETURNS SETOF public.v_posts_with_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.posts
  SET status = 'in_process', claimed_at = NULL
  WHERE status = 'qualifying'
    AND claimed_at < now() - interval '30 minutes';

  RETURN QUERY
  WITH to_claim AS (
    SELECT p.id
    FROM public.posts p
    LEFT JOIN public.events e ON e.id = p.event_id
    WHERE p.status = 'in_process'
      AND p.posted_at IS NOT NULL
      AND (e.is_adhoc = false OR p.event_id IS NULL)
    ORDER BY p.created_at
    LIMIT p_limit
    FOR UPDATE OF p SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.posts p
    SET status = 'qualifying', claimed_at = now()
    FROM to_claim tc
    WHERE p.id = tc.id
    RETURNING p.id
  )
  SELECT v.*
  FROM public.v_posts_with_events v
  JOIN claimed c ON c.id = v.id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_posts_for_qualification(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_posts_for_qualification(integer) TO service_role;
