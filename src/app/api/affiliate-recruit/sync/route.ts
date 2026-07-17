import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
// Same engine the local CLI runs (plain ESM, supabase-js only).
import { syncAffiliateRecruits } from "../../../../../pipeline/lib/affiliate-recruit-core.mjs";

// Qualification sweeps every event 1-21 days out; give it room.
export const maxDuration = 300;

/**
 * Daily affiliate-recruit sync (n8n schedule calls this):
 * qualifies solo founders/students attending upcoming events into
 * affiliate_recruit_targets (which also suppresses them from the customer
 * pipeline), Reoon-verifies the email track at T-2 weeks, pushes safe
 * addresses to the Plusvibe affiliate campaign, and flips unsafe ones to the
 * LinkedIn track. Protected by ?secret=PIPELINE_CRON_SECRET.
 * ?dry_run=1 reports without writing or calling paid APIs.
 */
async function handle(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (!process.env.PIPELINE_CRON_SECRET || secret !== process.env.PIPELINE_CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dry_run") === "1";

  try {
    const supabase = createAdminClient();
    const summary = await syncAffiliateRecruits(supabase, { dryRun });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("affiliate-recruit/sync failed:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
