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
  event_industry: string | null;
  event_slug?: string;
  is_active: boolean;
  is_whogoes_active: boolean;
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
  is_whogoes_active: boolean;
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
  // Effective per-contact event role (attendee | expected_attendee | sponsor |
  // exhibitor | organizer) + speaker flag, from get_event_preview. Optional so
  // older callers/shapes without these fields still type-check.
  event_role?: string | null;
  is_speaker?: boolean | null;
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
  has_email?: boolean;
  email_unlocked?: boolean;
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
  // "Processed" flag: set by the user (or the opt-in checkbox when downloading a
  // CSV), never automatically. Column names are historical.
  is_downloaded: boolean;
  downloaded_at: string | null;
  // Free-text note the user saved on this lead.
  lead_note?: string | null;
  // Event-role + standardized buckets (added 2026-06-21). event_role is one of
  // attendee | sponsor | exhibitor | organizer. Buckets are the clean classified
  // values; the free-text company_industry/company_size above are the legacy fields.
  event_role?: string | null;
  company_size_bucket?: string | null;
  company_industry_bucket?: string | null;
  // True when this contact spoke at the event (per contact_events.is_speaker).
  is_speaker?: boolean | null;
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
  // Unlock-history batch this call wrote to; chunked unlocks pass it back so all
  // chunks of one logical unlock share a single batch row.
  batch_id?: string;
  // Full-list bonus: true when this unfiltered unlock completed the whole event,
  // which includes the batch's verified emails at no extra credit.
  full_list?: boolean;
  emails_included?: number;
}

// A persisted unlock: which filters were active, when, and how many contacts it
// delivered. Rows older than the feature have no batch and show as "earlier unlocks".
export interface UnlockBatch {
  id: string;
  event_id: string;
  filters: Record<string, unknown>;
  requested_count: number | null;
  unlocked_count: number;
  created_at: string;
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

export interface ApiKeyDisplay {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  daily_credit_cap: number | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
