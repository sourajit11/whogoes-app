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
