-- ============================================
-- ROLLBACK: Security Advisor Fixes
-- Only run this if something breaks after the main migration.
-- This restores the database to its pre-migration state.
-- ============================================

BEGIN;


-- =======================================================
-- ROLLBACK PART 1: Re-grant view access
-- =======================================================
GRANT SELECT ON admin_customer_overview TO anon, authenticated;
GRANT SELECT ON admin_revenue_summary TO anon, authenticated;
GRANT SELECT ON admin_event_popularity TO anon, authenticated;
GRANT SELECT ON admin_data_quality TO anon, authenticated;
GRANT SELECT ON v_contacts_for_reprofile TO anon, authenticated;
GRANT SELECT ON v_mentions_pending TO anon, authenticated;
GRANT SELECT ON v_posts_with_events TO anon, authenticated;
GRANT SELECT ON v_contacts_for_enrichment TO anon, authenticated;
GRANT SELECT ON v_companies_for_enrichment TO anon, authenticated;
GRANT SELECT ON v_event_contacts TO anon, authenticated;


-- =======================================================
-- ROLLBACK PART 2: Recreate the "always true" write policies
-- =======================================================

-- companies
CREATE POLICY "Service role can delete companies" ON companies FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role can insert companies" ON companies FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Service role can update companies" ON companies FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- contact_emails
CREATE POLICY "Service role can delete contact emails" ON contact_emails FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role can insert contact emails" ON contact_emails FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Service role can update contact emails" ON contact_emails FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- contact_events
CREATE POLICY "Service role can delete contact events" ON contact_events FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role can insert contact events" ON contact_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Service role can update contact events" ON contact_events FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- contacts
CREATE POLICY "Service role can delete contacts" ON contacts FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role can insert contacts" ON contacts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Service role can update contacts" ON contacts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- email_threads
CREATE POLICY "Service role can delete email threads" ON email_threads FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role can insert email threads" ON email_threads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Service role can update email threads" ON email_threads FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- events
CREATE POLICY "Service role can delete events" ON events FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role can insert events" ON events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Service role can update events" ON events FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- outreach_campaigns
CREATE POLICY "Service role can delete outreach campaigns" ON outreach_campaigns FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role can insert outreach campaigns" ON outreach_campaigns FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Service role can update outreach campaigns" ON outreach_campaigns FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- post_mentions
CREATE POLICY "Service role can delete post mentions" ON post_mentions FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role can insert post mentions" ON post_mentions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Service role can update post mentions" ON post_mentions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- posts
CREATE POLICY "Service role can delete posts" ON posts FOR DELETE TO authenticated USING (true);
CREATE POLICY "Service role can insert posts" ON posts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Service role can update posts" ON posts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


-- =======================================================
-- ROLLBACK PART 3: Reset function search_path
-- =======================================================
ALTER FUNCTION get_customer_credits() RESET search_path;
ALTER FUNCTION unlock_event_contacts(uuid, integer) RESET search_path;
ALTER FUNCTION get_event_unlock_status(uuid) RESET search_path;
ALTER FUNCTION get_subscribed_events() RESET search_path;
ALTER FUNCTION get_event_preview(uuid) RESET search_path;
ALTER FUNCTION get_event_by_slug(text) RESET search_path;
ALTER FUNCTION get_all_browsable_events(integer, text, integer, integer) RESET search_path;
ALTER FUNCTION get_subscribed_event_contacts(uuid, text) RESET search_path;
ALTER FUNCTION mark_contacts_downloaded(uuid, uuid[]) RESET search_path;
ALTER FUNCTION complete_payment(text, text, text) RESET search_path;
ALTER FUNCTION get_payment_history() RESET search_path;
ALTER FUNCTION get_usage_history() RESET search_path;
ALTER FUNCTION get_dashboard_overview() RESET search_path;
ALTER FUNCTION get_my_events() RESET search_path;
ALTER FUNCTION subscribe_to_event(uuid) RESET search_path;
ALTER FUNCTION get_event_contacts(uuid) RESET search_path;
ALTER FUNCTION admin_get_business_stats() RESET search_path;
ALTER FUNCTION admin_adjust_credits(uuid, integer) RESET search_path;
ALTER FUNCTION admin_add_credits(uuid, integer) RESET search_path;
ALTER FUNCTION admin_get_dashboard_data(date, date) RESET search_path;
ALTER FUNCTION upsert_contact(text, text, text) RESET search_path;
ALTER FUNCTION upsert_company(text, text, text, text, text, text) RESET search_path;
ALTER FUNCTION link_contact_to_event(uuid, uuid, uuid, text, text, text) RESET search_path;
ALTER FUNCTION enrich_company(uuid, text, text, text, text, text, text, text, text, integer, text, text, text, integer, integer) RESET search_path;
ALTER FUNCTION merge_duplicate_contacts(uuid, uuid) RESET search_path;
ALTER FUNCTION delete_orphaned_posts() RESET search_path;
ALTER FUNCTION process_daily_credit_deductions() RESET search_path;
ALTER FUNCTION normalize_linkedin_company_url(text) RESET search_path;


-- =======================================================
-- ROLLBACK PART 4: Revert RLS initplan to original
-- =======================================================
ALTER POLICY "Users can read own credits" ON customer_credits USING (auth.uid() = user_id);
ALTER POLICY "Users can read own subscriptions" ON customer_event_subscriptions USING (auth.uid() = user_id);
ALTER POLICY "Users can read own access" ON customer_contact_access USING (auth.uid() = user_id);
ALTER POLICY "Users can update own access" ON customer_contact_access USING (auth.uid() = user_id);
ALTER POLICY "Users can read own signup" ON user_signups USING (auth.uid() = user_id);
ALTER POLICY "Users can read own customer record" ON customers USING (auth.uid() = user_id);
ALTER POLICY "Users read own payments" ON payments USING (auth.uid() = user_id);


COMMIT;
