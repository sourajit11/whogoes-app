-- ============================================
-- WhoGoes Admin Dashboard - Views & RPCs
-- Run in Supabase SQL Editor AFTER 02-unlock-rpcs.sql
-- These are queried via service_role client (bypasses RLS)
--
-- Credit tables:
--   user_signups: user_id, free_credits (trial credits)
--   customers:    user_id, credits_balance, total_purchased_credits, total_paid_amount
--
-- Actual schema:
--   events: id, name, year, is_active, location, region, start_date, ...
--   contacts: id, full_name, linkedin_url, current_title, city, country, ...
--   contact_events: contact_id, event_id (junction table)
--   contact_emails: contact_id, email, status, is_primary
--   v_event_contacts: pre-joined view with event_id, contact_id, email, etc.
-- ============================================

-- VIEW: All users with signup date, credit balance split, and usage stats
CREATE OR REPLACE VIEW admin_customer_overview AS
SELECT
  u.id AS user_id,
  u.email,
  u.created_at AS signed_up_at,
  COALESCE(us.free_credits, 0) AS free_credits,
  COALESCE(c.credits_balance, 0) AS paid_credits,
  COALESCE(us.free_credits, 0) + COALESCE(c.credits_balance, 0) AS credit_balance,
  COALESCE(usage.total_unlocked, 0) AS contacts_unlocked,
  COALESCE(c.total_paid_amount, 0) AS total_paid_amount,
  COALESCE(subs.event_count, 0) AS subscribed_events,
  usage.last_activity
FROM auth.users u
LEFT JOIN user_signups us ON us.user_id = u.id
LEFT JOIN customers c ON c.user_id = u.id
LEFT JOIN (
  SELECT
    user_id,
    COUNT(*) AS total_unlocked,
    MAX(charged_at) AS last_activity
  FROM customer_contact_access
  GROUP BY user_id
) usage ON usage.user_id = u.id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS event_count
  FROM customer_event_subscriptions
  GROUP BY user_id
) subs ON subs.user_id = u.id
ORDER BY u.created_at DESC;


-- VIEW: Monthly revenue breakdown (credits consumed as revenue proxy)
CREATE OR REPLACE VIEW admin_revenue_summary AS
SELECT
  date_trunc('month', charged_at) AS month,
  COUNT(*) AS credits_consumed,
  COUNT(DISTINCT user_id) AS active_users,
  COUNT(DISTINCT event_id) AS events_accessed
FROM customer_contact_access
GROUP BY date_trunc('month', charged_at)
ORDER BY month DESC;


-- VIEW: Event popularity by subscriptions and unlock count
-- Uses contact_events junction + contact_emails for contact stats
CREATE OR REPLACE VIEW admin_event_popularity AS
SELECT
  e.id AS event_id,
  e.name AS event_name,
  e.year AS event_year,
  e.is_active,
  COALESCE(subs.subscriber_count, 0) AS subscriber_count,
  COALESCE(access.total_unlocks, 0) AS total_unlocks,
  COALESCE(contact_stats.total_contacts, 0) AS total_contacts,
  COALESCE(contact_stats.contacts_with_email, 0) AS contacts_with_email
FROM events e
LEFT JOIN (
  SELECT event_id, COUNT(DISTINCT user_id) AS subscriber_count
  FROM customer_event_subscriptions
  GROUP BY event_id
) subs ON subs.event_id = e.id
LEFT JOIN (
  SELECT event_id, COUNT(*) AS total_unlocks
  FROM customer_contact_access
  GROUP BY event_id
) access ON access.event_id = e.id
LEFT JOIN (
  SELECT
    ce.event_id,
    COUNT(DISTINCT ce.contact_id) AS total_contacts,
    COUNT(DISTINCT CASE WHEN em.email IS NOT NULL AND em.email != '' THEN ce.contact_id END) AS contacts_with_email
  FROM contact_events ce
  LEFT JOIN contact_emails em ON em.contact_id = ce.contact_id AND em.is_primary = true
  GROUP BY ce.event_id
) contact_stats ON contact_stats.event_id = e.id
ORDER BY subs.subscriber_count DESC NULLS LAST;


-- VIEW: Per-event data quality metrics
-- Uses v_event_contacts view which already has all joined fields
CREATE OR REPLACE VIEW admin_data_quality AS
SELECT
  vec.event_id,
  vec.event_name,
  COUNT(*) AS total_contacts,
  COUNT(*) FILTER (WHERE vec.email IS NOT NULL AND vec.email != '') AS with_email,
  COUNT(*) FILTER (WHERE vec.contact_linkedin_url IS NOT NULL AND vec.contact_linkedin_url != '') AS with_linkedin,
  COUNT(*) FILTER (WHERE vec.company_name IS NOT NULL AND vec.company_name != '') AS with_company,
  COUNT(*) FILTER (WHERE vec.current_title IS NOT NULL AND vec.current_title != '') AS with_title,
  COUNT(*) FILTER (WHERE vec.post_url IS NOT NULL AND vec.post_url != '') AS with_post_url,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE vec.email IS NOT NULL AND vec.email != '') / NULLIF(COUNT(*), 0), 1
  ) AS email_rate,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE vec.contact_linkedin_url IS NOT NULL AND vec.contact_linkedin_url != '') / NULLIF(COUNT(*), 0), 1
  ) AS linkedin_rate
FROM v_event_contacts vec
GROUP BY vec.event_id, vec.event_name
ORDER BY total_contacts DESC;


-- RPC: Key business metrics in one call
CREATE OR REPLACE FUNCTION admin_get_business_stats()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_total_users INTEGER;
  v_users_this_month INTEGER;
  v_total_credits_consumed INTEGER;
  v_credits_this_month INTEGER;
  v_total_events INTEGER;
  v_active_events INTEGER;
  v_total_contacts INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total_users FROM auth.users;

  SELECT COUNT(*) INTO v_users_this_month
  FROM auth.users
  WHERE created_at >= date_trunc('month', now());

  SELECT COUNT(*) INTO v_total_credits_consumed
  FROM customer_contact_access;

  SELECT COUNT(*) INTO v_credits_this_month
  FROM customer_contact_access
  WHERE charged_at >= date_trunc('month', now());

  SELECT COUNT(*) INTO v_total_events FROM events;

  SELECT COUNT(*) INTO v_active_events
  FROM events WHERE is_active = true;

  SELECT COUNT(*) INTO v_total_contacts FROM contacts;

  RETURN json_build_object(
    'total_users', v_total_users,
    'users_this_month', v_users_this_month,
    'total_credits_consumed', v_total_credits_consumed,
    'credits_this_month', v_credits_this_month,
    'total_events', v_total_events,
    'active_events', v_active_events,
    'total_contacts', v_total_contacts
  );
END;
$$;


-- RPC: Manually adjust a user's paid credit balance
-- Adjusts the customers table (paid credits). Creates row if needed.
CREATE OR REPLACE FUNCTION admin_adjust_credits(
  p_user_id UUID,
  p_new_balance INTEGER
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  IF p_new_balance < 0 THEN
    RETURN json_build_object('success', false, 'message', 'Balance cannot be negative');
  END IF;

  UPDATE customers
  SET credits_balance = p_new_balance, updated_at = now()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO customers (user_id, credits_balance, total_purchased_credits, total_paid_amount)
    VALUES (p_user_id, p_new_balance, p_new_balance, 0);
  END IF;

  RETURN json_build_object(
    'success', true,
    'message', 'Paid credits updated',
    'new_balance', p_new_balance
  );
END;
$$;
