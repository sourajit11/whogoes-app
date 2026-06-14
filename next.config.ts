import type { NextConfig } from "next";

// Domain-consolidation migration (see DOMAIN_CONSOLIDATION_PLAN.md).
// When NEXT_PUBLIC_CONTENT_DOMAIN is set to the apex (e.g. https://whogoes.co)
// and differs from the app subdomain, we 301 the content paths from the old
// app.whogoes.co URLs to the new apex URLs. The `has` host condition is
// essential under Path A (reverse proxy): only requests arriving on
// app.whogoes.co are redirected, so proxied apex requests serve content
// normally instead of looping. Defaults to inert until the env var is set.
const APP_HOST = "app.whogoes.co";
const CONTENT_DOMAIN = process.env.NEXT_PUBLIC_CONTENT_DOMAIN?.trim().replace(/\/+$/, "");
const CONTENT_MIGRATED = !!CONTENT_DOMAIN && CONTENT_DOMAIN !== `https://${APP_HOST}`;

const migrationRedirects = CONTENT_MIGRATED
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
