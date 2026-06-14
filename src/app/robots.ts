import type { MetadataRoute } from "next";
import { contentUrl } from "@/lib/site";

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
      contentUrl("/sitemap.xml"),
      contentUrl("/sitemap/0.xml"),
      contentUrl("/sitemap/1.xml"),
      contentUrl("/sitemap/2.xml"),
    ],
  };
}
