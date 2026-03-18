-- CEO Dashboard RPC: daily-granularity data for admin dashboard
-- Returns daily signups, revenue, credits consumed, and active users

CREATE OR REPLACE FUNCTION admin_get_dashboard_data(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_daily_signups JSON;
  v_daily_revenue JSON;
  v_daily_credits JSON;
  v_daily_active_users JSON;
BEGIN
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  INTO v_daily_signups
  FROM (
    SELECT
      (created_at AT TIME ZONE 'UTC')::date AS date,
      COUNT(*) AS count
    FROM auth.users
    WHERE (created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
    GROUP BY (created_at AT TIME ZONE 'UTC')::date
    ORDER BY date
  ) t;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  INTO v_daily_revenue
  FROM (
    SELECT
      (paid_at AT TIME ZONE 'UTC')::date AS date,
      SUM(amount_usd)::numeric(10,2) AS revenue,
      COUNT(*) AS transactions,
      COUNT(DISTINCT user_id) AS paying_users,
      SUM(credits) AS credits_sold
    FROM payments
    WHERE status = 'paid'
      AND (paid_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
    GROUP BY (paid_at AT TIME ZONE 'UTC')::date
    ORDER BY date
  ) t;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  INTO v_daily_credits
  FROM (
    SELECT
      (charged_at AT TIME ZONE 'UTC')::date AS date,
      COUNT(*) AS credits_consumed
    FROM customer_contact_access
    WHERE (charged_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
    GROUP BY (charged_at AT TIME ZONE 'UTC')::date
    ORDER BY date
  ) t;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
  INTO v_daily_active_users
  FROM (
    SELECT
      (charged_at AT TIME ZONE 'UTC')::date AS date,
      COUNT(DISTINCT user_id) AS active_users
    FROM customer_contact_access
    WHERE (charged_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
    GROUP BY (charged_at AT TIME ZONE 'UTC')::date
    ORDER BY date
  ) t;

  RETURN json_build_object(
    'daily_signups', v_daily_signups,
    'daily_revenue', v_daily_revenue,
    'daily_credits', v_daily_credits,
    'daily_active_users', v_daily_active_users
  );
END;
$$;
