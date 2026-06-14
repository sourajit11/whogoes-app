import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { updatePipelineState } from "../../../../../pipeline/lib/events.mjs";

export const maxDuration = 60;

type Watermark = {
  event_id: string;
  last_contact_created_at: string;
  count: number;
  previous_total?: number;
};

/**
 * Advances the pipeline_state watermark for each event whose leads were
 * successfully pushed to Plusvibe. Called by n8n AFTER /lead/add succeeds, so a
 * failed push never skips contacts. Protected by ?secret=PIPELINE_CRON_SECRET.
 */
async function handle(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (!process.env.PIPELINE_CRON_SECRET || secret !== process.env.PIPELINE_CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { watermarks?: Watermark[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const watermarks = body.watermarks;
  if (!Array.isArray(watermarks)) {
    return NextResponse.json(
      { error: "Body must include a watermarks array" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const updated: string[] = [];
  const errors: string[] = [];

  for (const w of watermarks) {
    if (!w?.event_id || !w?.last_contact_created_at) continue;
    try {
      await updatePipelineState(
        supabase,
        w.event_id,
        w.count || 0,
        w.last_contact_created_at,
        w.previous_total || 0
      );
      updated.push(w.event_id);
    } catch (err) {
      errors.push(`${w.event_id}: ${String(err)}`);
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    updated: updated.length,
    errors,
  });
}

export const POST = handle;
