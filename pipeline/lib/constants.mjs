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

// Events must have at least this many total contacts to qualify (attendees on
// the event, whether or not they have an email yet).
export const MIN_TOTAL_CONTACTS = 200;

// Only include contacts that have "settled" (3+ hours old)
export const SETTLED_HOURS = 3;

// Plusvibe campaign routing: events further out than this are not worth
// outreach yet, so they are dropped entirely.
export const MAX_HORIZON_DAYS = 21;

/**
 * Map an event start date to a Plusvibe campaign bucket.
 *   <= 21 days out  -> "urgent"
 *   past or > 21    -> null (drop)
 *
 * The 3-day lower bound is applied upstream in getQualifyingEvents(), which
 * never returns an event starting sooner than that.
 */
export function getCampaignBucket(startDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDate = new Date(startDate);
  eventDate.setHours(0, 0, 0, 0);
  const daysOut = Math.round((eventDate - today) / (1000 * 60 * 60 * 24));
  if (daysOut < 0) return null;
  if (daysOut <= MAX_HORIZON_DAYS) return "urgent";
  return null;
}
