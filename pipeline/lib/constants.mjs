export const PERSONAL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "mail.com", "protonmail.com", "zoho.com", "yandex.com",
  "live.com", "msn.com", "me.com", "qq.com", "163.com", "gmx.com",
  "yahoo.co.in", "rediffmail.com", "inbox.com", "fastmail.com",
]);

export function isPersonalEmail(email) {
  const domain = email.split("@")[1]?.toLowerCase();
  return PERSONAL_DOMAINS.has(domain);
}

// Events must have at least this many contacts with email to qualify
export const MIN_CONTACTS_WITH_EMAIL = 100;

// Only include contacts that have "settled" (3+ hours old)
export const SETTLED_HOURS = 3;

// Plusvibe campaign routing: events further out than this are not worth
// outreach yet, so they are dropped entirely.
export const MAX_HORIZON_DAYS = 42;

/**
 * Map an event start date to a Plusvibe campaign bucket.
 *   <= 14 days out  -> "urgent"
 *   15-42 days out  -> "early"
 *   past or > 42    -> null (drop)
 */
export function getCampaignBucket(startDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDate = new Date(startDate);
  eventDate.setHours(0, 0, 0, 0);
  const daysOut = Math.round((eventDate - today) / (1000 * 60 * 60 * 24));
  if (daysOut < 0) return null;
  if (daysOut <= 14) return "urgent";
  if (daysOut <= MAX_HORIZON_DAYS) return "early";
  return null;
}
