#!/usr/bin/env node

/**
 * SEO Health Check — run before or after every deploy to catch indexing issues.
 *
 * Checks:
 * 1. /sitemap.xml returns 200 + valid XML
 * 2. /sitemap/0.xml, /sitemap/1.xml, /sitemap/2.xml return 200 + valid XML
 * 3. /robots.txt returns 200 + references sitemaps
 * 4. Every published blog post returns 200 (no redirect to /login)
 * 5. No blog post has noindex meta tag or X-Robots-Tag header
 * 6. Every blog post has a canonical tag
 * 7. IndexNow key verification file is accessible
 *
 * Usage:
 *   node scripts/check-seo-health.mjs                    # Check production
 *   node scripts/check-seo-health.mjs --base=http://localhost:3000  # Check local
 *
 * Exit code 1 on any failure.
 */

const BASE = process.argv.find((a) => a.startsWith("--base="))?.split("=")[1] || "https://app.whogoes.co";

let failures = 0;
let passes = 0;

function pass(msg) {
  passes++;
  console.log(`  ✅ ${msg}`);
}

function fail(msg) {
  failures++;
  console.log(`  ❌ ${msg}`);
}

async function checkUrl(url, { expectXml = false, expectContains = null, label = url } = {}) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location") || "unknown";
      fail(`${label} → ${res.status} redirect to ${location}`);
      return null;
    }
    if (res.status !== 200) {
      fail(`${label} → ${res.status}`);
      return null;
    }
    const body = await res.text();
    if (expectXml && !body.includes("<?xml")) {
      fail(`${label} → 200 but not valid XML`);
      return body;
    }
    if (expectContains && !body.includes(expectContains)) {
      fail(`${label} → missing expected content: "${expectContains}"`);
      return body;
    }
    pass(`${label} → 200 OK`);
    return body;
  } catch (e) {
    fail(`${label} → fetch error: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log(`\n🔍 SEO Health Check — ${BASE}\n`);

  // 1. Sitemap index
  console.log("── Sitemaps ──");
  await checkUrl(`${BASE}/sitemap.xml`, { expectXml: true, label: "/sitemap.xml" });
  const sitemap0 = await checkUrl(`${BASE}/sitemap/0.xml`, { expectXml: true, label: "/sitemap/0.xml (blog)" });
  await checkUrl(`${BASE}/sitemap/1.xml`, { expectXml: true, label: "/sitemap/1.xml (compare)" });
  await checkUrl(`${BASE}/sitemap/2.xml`, { expectXml: true, label: "/sitemap/2.xml (events)" });

  // 2. Robots.txt
  console.log("\n── Robots.txt ──");
  const robotsBody = await checkUrl(`${BASE}/robots.txt`, { label: "/robots.txt" });
  if (robotsBody) {
    if (robotsBody.includes("sitemap")) {
      pass("robots.txt references sitemaps");
    } else {
      fail("robots.txt does NOT reference any sitemap");
    }
    if (robotsBody.includes("Disallow: /dashboard/")) {
      pass("robots.txt blocks /dashboard/");
    } else {
      fail("robots.txt missing Disallow: /dashboard/");
    }
  }

  // 3. IndexNow verification file
  console.log("\n── IndexNow ──");
  await checkUrl(`${BASE}/c46c644d8da9be79f7cf73acfccfb6ac.txt`, {
    label: "IndexNow key file",
    expectContains: "c46c644d8da9be79f7cf73acfccfb6ac",
  });

  // 4. Blog posts — extract slugs from sitemap/0.xml
  console.log("\n── Blog Posts ──");
  let blogSlugs = [];
  if (sitemap0) {
    const matches = sitemap0.matchAll(/<loc>https?:\/\/[^/]+\/blog\/([^<]+)<\/loc>/g);
    blogSlugs = [...matches].map((m) => m[1]);
  }

  if (blogSlugs.length === 0) {
    fail("Could not extract blog slugs from sitemap/0.xml — skipping blog checks");
  } else {
    console.log(`  Found ${blogSlugs.length} blog posts in sitemap\n`);

    // Check each blog post (in batches to avoid hammering)
    const BATCH_SIZE = 5;
    for (let i = 0; i < blogSlugs.length; i += BATCH_SIZE) {
      const batch = blogSlugs.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (slug) => {
          const url = `${BASE}/blog/${slug}`;
          try {
            const res = await fetch(url, { redirect: "manual" });
            if (res.status >= 300 && res.status < 400) {
              const loc = res.headers.get("location") || "?";
              fail(`/blog/${slug} → ${res.status} redirect to ${loc}`);
              return;
            }
            if (res.status !== 200) {
              fail(`/blog/${slug} → ${res.status}`);
              return;
            }

            // Check headers
            const xRobots = res.headers.get("x-robots-tag") || "";
            if (xRobots.toLowerCase().includes("noindex")) {
              fail(`/blog/${slug} → X-Robots-Tag: noindex`);
              return;
            }

            // Check body
            const body = await res.text();
            if (body.includes('name="robots" content="noindex')) {
              fail(`/blog/${slug} → has noindex meta tag`);
              return;
            }
            if (!body.includes('rel="canonical"')) {
              fail(`/blog/${slug} → missing canonical tag`);
              return;
            }

            pass(`/blog/${slug}`);
          } catch (e) {
            fail(`/blog/${slug} → ${e.message}`);
          }
        })
      );
    }
  }

  // Summary
  console.log(`\n${"═".repeat(40)}`);
  console.log(`  ${passes} passed, ${failures} failed`);
  console.log(`${"═".repeat(40)}\n`);

  if (failures > 0) {
    console.log("⚠️  Fix the issues above before deploying.\n");
    process.exit(1);
  } else {
    console.log("🎉 All SEO checks passed!\n");
  }
}

main();
