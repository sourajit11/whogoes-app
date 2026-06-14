/**
 * Central domain config for public SEO surfaces.
 *
 * APP_URL serves the product (dashboard, login, auth, affiliate portal) and
 * never moves off the subdomain.
 *
 * CONTENT_URL serves the indexable marketing content (/blog, /events, /compare).
 * During the domain-consolidation migration it flips from the app subdomain to
 * the apex by setting NEXT_PUBLIC_CONTENT_DOMAIN (e.g. "https://whogoes.co").
 * It defaults to APP_URL so deploying this change is a no-op until that env var
 * is set during the migration window. See DOMAIN_CONSOLIDATION_PLAN.md.
 */
export const APP_URL = "https://app.whogoes.co";

const rawContentDomain = process.env.NEXT_PUBLIC_CONTENT_DOMAIN?.trim();

export const CONTENT_URL = rawContentDomain
  ? rawContentDomain.replace(/\/+$/, "")
  : APP_URL;

/** True once content has been migrated to its own (apex) domain. */
export const CONTENT_MIGRATED = CONTENT_URL !== APP_URL;

/** Absolute URL on the content domain. Pass a leading-slash path. */
export function contentUrl(path = ""): string {
  if (!path) return CONTENT_URL;
  return `${CONTENT_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Absolute URL on the app (product) domain. */
export function appUrl(path = ""): string {
  if (!path) return APP_URL;
  return `${APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
