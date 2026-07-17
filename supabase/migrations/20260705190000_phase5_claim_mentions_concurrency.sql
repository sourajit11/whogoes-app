-- Phase 5 mention-enrichment concurrency guard (2026-07-05).
--
-- Problem: Phase 5 (n8n 6tcgKJUptrd41cbz) read ALL pending mentions via returnAll and looped
-- them sequentially. With a large queue an execution runs well past the 30-min schedule, so the
-- next scheduled trigger starts on top of the still-running one and both process the SAME pending
-- rows in parallel (wasted enrichment API calls). Enrichment is idempotent (upsert by LinkedIn
-- URL) + Instantly dedupes, so no duplicate contacts/emails result, but the wasted spend is real.
--
-- Fix: a claim RPC using FOR UPDATE SKIP LOCKED (same pattern as claim_posts_for_qualification)
-- that hands each Phase 5 run a DISJOINT batch. Two overlapping runs can no longer touch the same
-- row. Self-healing: a claim older than 30 min (a run that died mid-batch) is released so the row
-- can be retried. No new enrichment_status value is needed — we only add a claimed_at timestamp,
-- so the enrichment_status enum/check is untouched.
--
-- After running this, wire Phase 5's "Get Pending Mentions" node to call the RPC instead of
-- reading the view (POST /rest/v1/rpc/claim_mentions_for_enrichment {"p_limit": 100}), then
-- re-activate the workflow.

ALTER TABLE public.post_mentions
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_post_mentions_claim
  ON public.post_mentions (enrichment_status, claimed_at);

CREATE OR REPLACE FUNCTION public.claim_mentions_for_enrichment(p_limit int DEFAULT 100)
RETURNS SETOF public.v_mentions_pending_master
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed uuid[];
BEGIN
  -- release stale claims (a Phase 5 run died mid-batch) so they can be retried
  UPDATE public.post_mentions
     SET claimed_at = NULL
   WHERE claimed_at IS NOT NULL
     AND claimed_at < now() - interval '30 minutes'
     AND enrichment_status = 'pending';

  -- atomically grab a disjoint batch: lock the base rows, SKIP LOCKED avoids overlap.
  -- Only rows the view considers processable (pending + not-already-linked) are eligible.
  SELECT array_agg(mention_id) INTO claimed
  FROM (
    SELECT v.mention_id
    FROM public.v_mentions_pending_master v
    JOIN public.post_mentions pm ON pm.id = v.mention_id AND pm.claimed_at IS NULL
    ORDER BY v.created_at
    FOR UPDATE OF pm SKIP LOCKED
    LIMIT p_limit
  ) s;

  IF claimed IS NULL THEN
    RETURN;  -- nothing to do this cycle
  END IF;

  -- mark them claimed (still enrichment_status='pending'; the claimed_at guard makes the next
  -- call skip them). Phase 5's Mark Mention * nodes flip them to enriched/no_email/not_found.
  UPDATE public.post_mentions
     SET claimed_at = now()
   WHERE id = ANY(claimed);

  -- return the claimed rows in the exact shape Phase 5 already consumes (the view row type)
  RETURN QUERY
    SELECT v.* FROM public.v_mentions_pending_master v WHERE v.mention_id = ANY(claimed);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_mentions_for_enrichment(int) TO anon, authenticated, service_role;
