import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAllPosts } from "@/lib/blog";
import { getAllComparisons } from "@/lib/compare";

const INDEXNOW_KEY = "c46c644d8da9be79f7cf73acfccfb6ac";
const HOST = "app.whogoes.co";

/**
 * POST /api/indexnow — Submit all public URLs to IndexNow (Bing, Yandex, etc.)
 * Protected by a simple secret query param: ?secret=<INDEXNOW_KEY>
 */
export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (secret !== INDEXNOW_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: events } = await supabase
    .from("events")
    .select("slug")
    .order("start_date", { ascending: false });

  const blogPosts = getAllPosts();
  const comparisons = getAllComparisons();

  const urls = [
    `https://${HOST}`,
    `https://${HOST}/events`,
    `https://${HOST}/blog`,
    `https://${HOST}/compare`,
    ...(events ?? []).map((e) => `https://${HOST}/events/${e.slug}`),
    ...blogPosts.map((p) => `https://${HOST}/blog/${p.meta.slug}`),
    ...comparisons.map((c) => `https://${HOST}/compare/${c.meta.slug}`),
  ];

  const payload = {
    host: HOST,
    key: INDEXNOW_KEY,
    keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`,
    urlList: urls.slice(0, 10000), // IndexNow max is 10,000
  };

  const response = await fetch("https://api.indexnow.org/IndexNow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return NextResponse.json({
    submitted: urls.length,
    status: response.status,
    message:
      response.status === 200 || response.status === 202
        ? "URLs submitted successfully"
        : "Submission may have failed — check IndexNow dashboard",
  });
}
