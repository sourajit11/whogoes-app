import type { NextConfig } from "next";

// Domain-consolidation migration (see DOMAIN_CONSOLIDATION_PLAN.md §8).
//
// Two SEPARATE switches, on purpose:
//
// 1. NEXT_PUBLIC_CONTENT_DOMAIN (the canonical flip) - handled in
//    src/lib/site.ts. Makes canonicals/sitemap/JSON-LD emit apex URLs. This is
//    the safe, primary consolidation lever and never causes a redirect loop.
//
// 2. ENABLE_CONTENT_301 (this block, the hard redirect) - only turn on AFTER
//    confirming the serving architecture is loop-safe. Under Path A (the apex
//    project reverse-proxies /blog,/events,/compare to this app), the proxied
//    request arrives with Host: app.whogoes.co, so a host-guarded 301 here
//    would bounce it back to the apex and LOOP. So leave this OFF for Path A
//    and rely on canonicals; only enable it under Path B (apex and app are the
//    same deployment on two domains), where the host guard cleanly separates a
//    direct app.whogoes.co hit (redirect) from a genuine apex hit (serve).
const APP_HOST = "app.whogoes.co";
const CONTENT_DOMAIN = process.env.NEXT_PUBLIC_CONTENT_DOMAIN?.trim().replace(/\/+$/, "");
const CONTENT_MIGRATED = !!CONTENT_DOMAIN && CONTENT_DOMAIN !== `https://${APP_HOST}`;
const ENABLE_CONTENT_301 = process.env.ENABLE_CONTENT_301 === "true";

const migrationRedirects = CONTENT_MIGRATED && ENABLE_CONTENT_301
  ? ["blog", "events", "compare"].map((seg) => ({
      source: `/${seg}/:path*`,
      has: [{ type: "host" as const, value: APP_HOST }],
      destination: `${CONTENT_DOMAIN}/${seg}/:path*`,
      statusCode: 301 as const,
    }))
  : [];

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // Next.js 16 doesn't auto-generate a sitemap index, so rewrite to our API route
        source: "/sitemap.xml",
        destination: "/api/sitemap-index",
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/blog/what-is-an-event-attendee-list",
        destination: "/blog/what-is-a-trade-show-attendee-list",
        statusCode: 301,
      },
      {
        source: "/blog/most-trusted-event-attendee-list-provider",
        destination: "/blog/best-trade-show-attendee-list-provider",
        statusCode: 301,
      },
      {
        source: "/pricing",
        destination: "https://whogoes.co/#pricing",
        statusCode: 301,
      },
      ...migrationRedirects,
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Root redirects to /dashboard or /login depending on auth — no public content to index
        source: "/",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/login",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/register",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/forgot-password",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/reset-password",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
