import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runColdDiscovery } from "../../../../../pipeline/lib/whogoes-cold-core.mjs";

// Vendor-throttled (Dropleads 60/min) — keep batches small (~25) so each call
// finishes well under the serverless limit. n8n loops this until the daily quota is met.
export const maxDuration = 300;

const DEFAULT_LIMIT = 25;

/**
 * Discover + enrich + verify up to `limit` unprocessed Apollo companies and upsert
 * the results into whogoes_prospects. Protected by ?secret=WHOGOES_COLD_SECRET.
 */
async function handle(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (!process.env.WHOGOES_COLD_SECRET || secret !== process.env.WHOGOES_COLD_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limitParam = request.nextUrl.searchParams.get("limit");
  // Cap at 30: ~8s/company (Dropleads-bound) keeps a 30-company call under the 300s limit.
  const limit = limitParam ? Math.max(1, Math.min(30, parseInt(limitParam, 10))) : DEFAULT_LIMIT;

  try {
    const supabase = createAdminClient();
    const result = await runColdDiscovery(supabase, { limit });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("whogoes-cold/discover failed:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
