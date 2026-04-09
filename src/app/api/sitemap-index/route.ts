import { NextResponse } from "next/server";

/**
 * Sitemap index — Next.js 16 doesn't auto-generate one when using
 * generateSitemaps(), so we serve it via API route + rewrite.
 *
 * Keep SITEMAP_IDS in sync with generateSitemaps() in src/app/sitemap.ts.
 */
const SITEMAP_IDS = [0, 1, 2];
const BASE = "https://app.whogoes.co";

export function GET() {
  const entries = SITEMAP_IDS.map(
    (id) =>
      `  <sitemap>\n    <loc>${BASE}/sitemap/${id}.xml</loc>\n  </sitemap>`
  ).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</sitemapindex>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
