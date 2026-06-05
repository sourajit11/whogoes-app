export interface AdminCustomer {
  user_id: string;
  email: string;
  signed_up_at: string;
  free_credits: number;
  paid_credits: number;
  credit_balance: number;
  contacts_unlocked: number;
  total_paid_amount: number;
  total_purchased_credits: number;
  last_payment_at: string | null;
  subscribed_events: number;
  last_activity: string | null;
  last_package: string | null;
  referred_by_email: string | null;
  referred_by_code: string | null;
  referral_source: "email_match" | "link" | null;
}

export interface AdminBusinessStats {
  total_users: number;
  users_this_month: number;
  total_credits_consumed: number;
  credits_this_month: number;
  total_events: number;
  active_events: number;
  total_contacts: number;
}

export interface AdminEventPopularity {
  event_id: string;
  event_name: string;
  event_year: number;
  is_active: boolean;
  subscriber_count: number;
  total_unlocks: number;
  total_contacts: number;
  contacts_with_email: number;
}

export interface AdminRevenueSummary {
  month: string;
  credits_consumed: number;
  active_users: number;
  events_accessed: number;
}

export interface AdminDataQuality {
  event_id: string;
  event_name: string;
  total_contacts: number;
  with_email: number;
  with_linkedin: number;
  with_company: number;
  with_title: number;
  with_post_url: number;
  email_rate: number;
  linkedin_rate: number;
}

export interface AdminCustomerDetail {
  user_id: string;
  email: string;
  signed_up_at: string;
  free_credits: number;
  paid_credits: number;
  credit_balance: number;
}

export interface AdminCustomerSubscription {
  event_id: string;
  event_name: string;
  subscribed_at: string;
  is_paused: boolean;
}

export interface AdminCustomerUnlock {
  contact_id: string;
  event_id: string;
  event_name: string;
  contact_name: string | null;
  contact_email: string | null;
  charged_at: string;
}

export interface AdminPayment {
  id: string;
  amount_usd: number;
  credits: number;
  package_name: string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
}

export interface AdminPaymentWithEmail {
  id: string;
  user_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  amount_usd: number;
  currency: string;
  credits: number;
  package_name: string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
  user_email: string;
}

// --- Affiliate program types ---

export interface AdminAffiliate {
  affiliate_id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  status: "pending" | "active" | "suspended";
  referral_code: string | null;
  pending_balance_usd: number;
  paid_balance_usd: number;
  total_earned_usd: number;
  created_at: string;
  approved_at: string | null;
  referral_count: number;
  paying_count: number;
  last_referral_at: string | null;
}

export interface AdminAffiliateReferral {
  id: string;
  email: string | null;
  source: "email_match" | "link";
  status: "active" | "voided";
  referred_at: string;
  first_purchase_at: string | null;
  earned_usd: number;
}

export interface AdminAffiliateCommission {
  id: string;
  amount_usd: number;
  commission_usd: number;
  status: "pending" | "paid" | "voided";
  created_at: string;
}

export interface AdminAffiliateContact {
  email: string | null;
  status: "pending" | "matched" | "expired";
  added_at: string;
  matched_at: string | null;
}

export interface AdminAffiliatePayout {
  id: string;
  amount_usd: number;
  status: "pending" | "paid";
  method: string | null;
  reference: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface AdminAffiliateDetail {
  affiliate: {
    id: string;
    email: string;
    display_name: string | null;
    status: "pending" | "active" | "suspended";
    referral_code: string | null;
    pending_balance_usd: number;
    paid_balance_usd: number;
    total_earned_usd: number;
    payout_method: string | null;
    payout_details: Record<string, unknown> | null;
    daily_contact_limit: number;
    created_at: string;
    approved_at: string | null;
  };
  referrals: AdminAffiliateReferral[];
  commissions: AdminAffiliateCommission[];
  contacts: AdminAffiliateContact[];
  payouts: AdminAffiliatePayout[];
}

// --- CEO Dashboard types ---

export type TimeRange = "today" | "7d" | "4w" | "3m" | "all";

export interface DailySignup {
  date: string;
  count: number;
}

export interface DailyRevenue {
  date: string;
  revenue: number;
  transactions: number;
  paying_users: number;
  credits_sold: number;
}

export interface DailyCredits {
  date: string;
  credits_consumed: number;
}

export interface DailyActiveUsers {
  date: string;
  active_users: number;
}

export interface DashboardData {
  daily_signups: DailySignup[];
  daily_revenue: DailyRevenue[];
  daily_credits: DailyCredits[];
  daily_active_users: DailyActiveUsers[];
}
