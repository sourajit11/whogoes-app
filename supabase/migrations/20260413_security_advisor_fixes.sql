-- ============================================
-- WhoGoes Security Advisor Fixes
-- Run: Sunday 2026-04-13 during low-traffic window
-- Run in: Supabase SQL Editor (or `supabase db push`)
--
-- IMPORTANT: This entire script is wrapped in a transaction.
-- If ANY statement fails, ALL changes are rolled back automatically.
-- Your database stays exactly as it was before.
--
-- What this fixes:
--   1. Revoke view access from anon/authenticated (auth exposure + security definer views)
--   2. Remove overly permissive RLS write policies (USING true for INSERT/UPDATE/DELETE)
--   3. Pin function search_path to 'public' (prevents search path injection)
--   4. Optimize RLS initplan (auth.uid() evaluated once, not per-row)
--
-- What this does NOT do:
--   - Delete any data
--   - Change any function logic
--   - Modify any table structure
--   - Affect service_role or SECURITY DEFINER operations
-- ============================================

BEGIN;


-- =======================================================
-- PART 1: Revoke view access from anon/authenticated
-- =======================================================
-- These views are only queried via service_role (createAdminClient).
-- service_role bypasses grants entirely, so this changes nothing
-- for the admin pages — it just closes the door for anon/authenticated.
--
-- The 4 admin views are actively used in admin pages.
-- The 6 other views exist in the DB but aren't referenced in app code.

REVOKE SELECT ON admin_customer_overview FROM anon, authenticated;
REVOKE SELECT ON admin_revenue_summary FROM anon, authenticated;
REVOKE SELECT ON admin_event_popularity FROM anon, authenticated;
REVOKE SELECT ON admin_data_quality FROM anon, authenticated;
REVOKE SELECT ON v_contacts_for_reprofile FROM anon, authenticated;
REVOKE SELECT ON v_mentions_pending FROM anon, authenticated;
REVOKE SELECT ON v_posts_with_events FROM anon, authenticated;
REVOKE SELECT ON v_contacts_for_enrichment FROM anon, authenticated;
REVOKE SELECT ON v_companies_for_enrichment FROM anon, authenticated;
REVOKE SELECT ON v_event_contacts FROM anon, authenticated;


-- =======================================================
-- PART 2: Remove overly permissive RLS write policies
-- =======================================================
-- These policies are named "Service role can ..." but are applied to
-- the `authenticated` role with USING(true), meaning ANY logged-in
-- user can INSERT/UPDATE/DELETE all rows.
--
-- All writes to these tables happen via:
--   - SECURITY DEFINER RPCs (bypass RLS)
--   - service_role client in pipeline/admin (bypass RLS)
-- So removing these policies breaks nothing.
--
-- SELECT policies (USING true for authenticated) are intentionally KEPT —
-- authenticated users need read access for browsing events/contacts.

-- companies
DROP POLICY "Service role can delete companies" ON companies;
DROP POLICY "Service role can insert companies" ON companies;
DROP POLICY "Service role can update companies" ON companies;

-- contact_emails
DROP POLICY "Service role can delete contact emails" ON contact_emails;
DROP POLICY "Service role can insert contact emails" ON contact_emails;
DROP POLICY "Service role can update contact emails" ON contact_emails;

-- contact_events
DROP POLICY "Service role can delete contact events" ON contact_events;
DROP POLICY "Service role can insert contact events" ON contact_events;
DROP POLICY "Service role can update contact events" ON contact_events;

-- contacts
DROP POLICY "Service role can delete contacts" ON contacts;
DROP POLICY "Service role can insert contacts" ON contacts;
DROP POLICY "Service role can update contacts" ON contacts;

-- email_threads
DROP POLICY "Service role can delete email threads" ON email_threads;
DROP POLICY "Service role can insert email threads" ON email_threads;
DROP POLICY "Service role can update email threads" ON email_threads;

-- events
DROP POLICY "Service role can delete events" ON events;
DROP POLICY "Service role can insert events" ON events;
DROP POLICY "Service role can update events" ON events;

-- outreach_campaigns
DROP POLICY "Service role can delete outreach campaigns" ON outreach_campaigns;
DROP POLICY "Service role can insert outreach campaigns" ON outreach_campaigns;
DROP POLICY "Service role can update outreach campaigns" ON outreach_campaigns;

-- post_mentions
DROP POLICY "Service role can delete post mentions" ON post_mentions;
DROP POLICY "Service role can insert post mentions" ON post_mentions;
DROP POLICY "Service role can update post mentions" ON post_mentions;

-- posts
DROP POLICY "Service role can delete posts" ON posts;
DROP POLICY "Service role can insert posts" ON posts;
DROP POLICY "Service role can update posts" ON posts;


-- =======================================================
-- PART 3: Fix function search_path (security)
-- =======================================================
-- Pins search_path to 'public' to prevent search path injection.
-- Using 'public' (NOT '') because all functions use unqualified
-- table names like "FROM contacts" instead of "FROM public.contacts".
-- This does NOT change any function logic — only restricts the
-- schema search order.

-- User-facing RPCs (called via anon/authenticated client)
ALTER FUNCTION get_customer_credits() SET search_path = 'public';
ALTER FUNCTION unlock_event_contacts(uuid, integer) SET search_path = 'public';
ALTER FUNCTION get_event_unlock_status(uuid) SET search_path = 'public';
ALTER FUNCTION get_subscribed_events() SET search_path = 'public';
ALTER FUNCTION get_event_preview(uuid) SET search_path = 'public';
ALTER FUNCTION get_event_by_slug(text) SET search_path = 'public';
ALTER FUNCTION get_all_browsable_events(integer, text, integer, integer) SET search_path = 'public';
ALTER FUNCTION get_subscribed_event_contacts(uuid, text) SET search_path = 'public';
ALTER FUNCTION mark_contacts_downloaded(uuid, uuid[]) SET search_path = 'public';
ALTER FUNCTION complete_payment(text, text, text) SET search_path = 'public';
ALTER FUNCTION get_payment_history() SET search_path = 'public';
ALTER FUNCTION get_usage_history() SET search_path = 'public';
ALTER FUNCTION get_dashboard_overview() SET search_path = 'public';
ALTER FUNCTION get_my_events() SET search_path = 'public';
ALTER FUNCTION subscribe_to_event(uuid) SET search_path = 'public';
ALTER FUNCTION get_event_contacts(uuid) SET search_path = 'public';

-- Admin RPCs (called via service_role client)
ALTER FUNCTION admin_get_business_stats() SET search_path = 'public';
ALTER FUNCTION admin_adjust_credits(uuid, integer) SET search_path = 'public';
ALTER FUNCTION admin_add_credits(uuid, integer) SET search_path = 'public';
ALTER FUNCTION admin_get_dashboard_data(date, date) SET search_path = 'public';

-- Pipeline/internal functions (called via service_role)
ALTER FUNCTION upsert_contact(text, text, text) SET search_path = 'public';
ALTER FUNCTION upsert_company(text, text, text, text, text, text) SET search_path = 'public';
ALTER FUNCTION link_contact_to_event(uuid, uuid, uuid, text, text, text) SET search_path = 'public';
ALTER FUNCTION enrich_company(uuid, text, text, text, text, text, text, text, text, integer, text, text, text, integer, integer) SET search_path = 'public';
ALTER FUNCTION merge_duplicate_contacts(uuid, uuid) SET search_path = 'public';
ALTER FUNCTION delete_orphaned_posts() SET search_path = 'public';
ALTER FUNCTION process_daily_credit_deductions() SET search_path = 'public';
ALTER FUNCTION normalize_linkedin_company_url(text) SET search_path = 'public';


-- =======================================================
-- PART 4: Fix RLS initplan (performance)
-- =======================================================
-- Wraps auth.uid() in (select auth.uid()) so PostgreSQL evaluates
-- it once per query instead of once per row. Pure performance fix,
-- zero behavior change.

ALTER POLICY "Users can read own credits"
  ON customer_credits
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can read own subscriptions"
  ON customer_event_subscriptions
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can read own access"
  ON customer_contact_access
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can update own access"
  ON customer_contact_access
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can read own signup"
  ON user_signups
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can read own customer record"
  ON customers
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Users read own payments"
  ON payments
  USING ((select auth.uid()) = user_id);


COMMIT;
