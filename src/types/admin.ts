export interface AdminCustomer {
  user_id: string;
  email: string;
  signed_up_at: string;
  free_credits: number;
  paid_credits: number;
  credit_balance: number;
  contacts_unlocked: number;
  total_paid_amount: number;
  subscribed_events: number;
  last_activity: string | null;
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
