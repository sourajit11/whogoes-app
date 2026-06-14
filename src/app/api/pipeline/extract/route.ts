import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
// Reuse the tested CLI extraction logic (plain ESM, supabase-js only).
import { extractRegionLeads } from "../../../../../pipeline/lib/extract-core.mjs";

// INIT runs on brand-new events can pull a lot of contacts; give them room.
export const maxDuration = 300;

const VALID_REGIONS = new Set(["US", "EU"]);
const DEFAULT_LIMIT = 1000;

/**
 * Extracts up to `limit` outreach leads for one region (urgent events first)
 * and returns them grouped for Plusvibe, WITHOUT advancing the pipeline_state
 * watermark. n8n pushes the leads to Plusvibe, then calls /api/pipeline/commit
 * with the returned `watermarks`. Protected by ?secret=PIPELINE_CRON_SECRET.
 */
async function handle(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (!process.env.PIPELINE_CRON_SECRET || secret !== process.env.PIPELINE_CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const region = (request.nextUrl.searchParams.get("region") || "").toUpperCase();
  if (!VALID_REGIONS.has(region)) {
    return NextResponse.json(
      { error: "Invalid region — must be US or EU" },
      { status: 400 }
    );
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, parseInt(limitParam, 10)) : DEFAULT_LIMIT;

  try {
    const supabase = createAdminClient();
    const result = await extractRegionLeads(supabase, { region, limit });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("pipeline/extract failed:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
