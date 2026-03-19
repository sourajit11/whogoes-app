export interface DashboardOverview {
  total_events_tracked: number;
  live_events: number;
  subscribed_events: number;
  total_accessible_contacts: number;
}

export interface BrowsableEvent {
  event_id: string;
  event_name: string;
  event_year: number;
  event_region: string | null;
  event_location: string | null;
  event_start_date: string | null;
  event_slug?: string;
  is_active: boolean;
  total_contacts: number;
  contacts_with_email: number;
  is_subscribed: boolean;
}

export interface SubscribedEvent {
  event_id: string;
  event_name: string;
  event_year: number;
  event_region: string | null;
  event_location: string | null;
  event_start_date: string | null;
  is_active: boolean;
  subscribed_at: string;
  is_paused: boolean;
  total_contacts: number;
  new_contacts: number;
  processed_contacts: number;
}

export interface ContactPreview {
  contact_id: string;
  full_name: string | null;
  current_title: string | null;
  company_name: string | null;
  city: string | null;
  country: string | null;
  total_contacts: number;
  post_url: string | null;
  post_date: string | null;
  company_domain: string | null;
  company_linkedin_url: string | null;
  company_industry: string | null;
  company_size: string | null;
  company_headquarters: string | null;
  company_founded_year: number | null;
  email: string | null;
  contact_linkedin_url: string | null;
}

export interface Contact {
  contact_id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  current_title: string | null;
  headline: string | null;
  contact_linkedin_url: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  email_status: string | null;
  email_provider: string | null;
  company_name: string | null;
  company_linkedin_url: string | null;
  company_domain: string | null;
  company_website: string | null;
  company_industry: string | null;
  company_size: string | null;
  company_headquarters: string | null;
  company_founded_year: number | null;
  company_description: string | null;
  post_url: string | null;
  post_content: string | null;
  post_date: string | null;
  source: string | null;
  first_line_personalization: string | null;
  is_downloaded: boolean;
  downloaded_at: string | null;
}

export interface SubscribeResult {
  success: boolean;
  message: string;
  credits_spent?: number;
  new_balance?: number;
  credits_needed?: number;
  current_balance?: number;
}

export interface UnlockResult {
  success: boolean;
  message: string;
  credits_spent?: number;
  new_balance?: number;
  contacts_unlocked?: number;
  current_balance?: number;
}

export interface EventUnlockStatus {
  total_contacts: number;
  unlocked_count: number;
  remaining_count: number;
  contacts_with_email: number;
  user_balance: number;
  is_subscribed: boolean;
}

export type SortKey = "full_name" | "current_title" | "company_name" | "email" | "post_date";
export type SortDir = "asc" | "desc";
