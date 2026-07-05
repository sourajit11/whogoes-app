import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pushColdToPlusvibe } from "../../../../../pipeline/lib/whogoes-cold-push.mjs";

export const maxDuration = 300;

/**
 * Push contactable, not-yet-sent whogoes_prospects into the Plusvibe cold campaign
 * and mark them 'sent'. Protected by ?secret=WHOGOES_COLD_SECRET.
 */
async function handle(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (!process.env.WHOGOES_COLD_SECRET || secret !== process.env.WHOGOES_COLD_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, parseInt(limitParam, 10)) : 2000;

  try {
    const supabase = createAdminClient();
    const result = await pushColdToPlusvibe(supabase, { limit });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("whogoes-cold/push failed:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
