import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/events/", "/events", "/blog/", "/blog", "/compare/", "/compare"],
        disallow: ["/dashboard/", "/admin/", "/api/", "/login", "/register"],
      },
    ],
    sitemap: [
      "https://app.whogoes.co/sitemap.xml",
      "https://app.whogoes.co/sitemap/0.xml",
      "https://app.whogoes.co/sitemap/1.xml",
      "https://app.whogoes.co/sitemap/2.xml",
    ],
  };
}
