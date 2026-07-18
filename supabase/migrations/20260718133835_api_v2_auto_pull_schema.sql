-- Public API v2 launch (2026-07-18): auto-pull rule storage + drainer logging support.
--
-- The public API hides the "subscription" concept: an auto-pull rule IS the existing
-- customer_event_subscriptions row (UNIQUE (user_id, event_id) already enforced), extended
-- with the ICP filter set and pricing/caps the API-driven drainer needs. Dashboard columns
-- (auto_unlock_enabled, is_paused, max_unlocks_per_event, last_api_pulled_at) are reused
-- unchanged so the in-app auto-unlock toggle keeps working: a dashboard toggle is simply an
-- unfiltered, emails-included rule.
--
--   pull_filters             ICP filter jsonb, same contract as event_filtered_contact_ids
--   pull_include_emails      filtered pulls bundle the +1cr email reveal per valid email
--   max_credits_per_day      per-rule daily spend cap (UTC day), NULL = uncapped
--   pull_credits_spent_today running spend for pull_spend_day, reset when the day changes
--
-- api_usage_log.api_key_id becomes nullable: the server-side auto-pull drainer runs on a
-- cron secret, not an API key, and logs its spend with api_key_id NULL. The idempotency
-- UNIQUE (api_key_id, idempotency_key) is unaffected (drainer rows carry NULL key + NULL
-- idempotency key, and NULLs never collide in a UNIQUE constraint).

ALTER TABLE public.customer_event_subscriptions
  ADD COLUMN IF NOT EXISTS pull_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pull_include_emails boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_credits_per_day integer,
  ADD COLUMN IF NOT EXISTS pull_credits_spent_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pull_spend_day date;

DO $$
BEGIN
  ALTER TABLE public.customer_event_subscriptions
    ADD CONSTRAINT ces_max_credits_per_day_non_negative
    CHECK (max_credits_per_day IS NULL OR max_credits_per_day >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.api_usage_log ALTER COLUMN api_key_id DROP NOT NULL;

-- Drainer picks up enabled, unpaused rules per user; partial index keeps that scan tiny.
CREATE INDEX IF NOT EXISTS idx_ces_auto_pull
  ON public.customer_event_subscriptions (user_id, subscribed_at)
  WHERE auto_unlock_enabled = true AND is_paused = false;

-- GET /v1/contacts?since= walks a user's unlocks across events by charged_at; the existing
-- (user_id, event_id, charged_at) index cannot serve the cross-event order.
CREATE INDEX IF NOT EXISTS idx_cca_user_charged
  ON public.customer_contact_access (user_id, charged_at DESC);
