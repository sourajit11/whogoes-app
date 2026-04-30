import type { NextConfig } from "next";

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
        permanent: true,
      },
      {
        source: "/blog/most-trusted-event-attendee-list-provider",
        destination: "/blog/best-trade-show-attendee-list-provider",
        permanent: true,
      },
      {
        source: "/pricing",
        destination: "https://whogoes.co/#pricing",
        permanent: true,
      },
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
