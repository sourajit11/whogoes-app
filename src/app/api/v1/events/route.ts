import { NextRequest, NextResponse } from "next/server";
import { gateRequest } from "@/lib/api/handler";
import { badRequest, serverError } from "@/lib/api/errors";
import { logApiUsage } from "@/lib/api/usage-logger";
import { createAdminClient } from "@/lib/supabase/admin";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/v1/events
 *
 * Browse active events. Free. Counts come from a periodically refreshed
 * cache; use the facets endpoint for live numbers on a specific event.
 *
 * Query params: year, region, country, industry, q (name search),
 * starts_after / starts_before (YYYY-MM-DD), limit (max 200), offset.
 */
export async function GET(request: NextRequest) {
  const gate = await gateRequest(request);
  if (gate instanceof NextResponse) return gate;
  const { auth, rateRemaining } = gate;

  const url = new URL(request.url);

  let year: number | null = null;
  const yearParam = url.searchParams.get("year");
  if (yearParam) {
    year = parseInt(yearParam, 10);
    if (!Number.isInteger(year)) return badRequest("year must be an integer");
  }

  for (const key of ["starts_after", "starts_before"]) {
    const value = url.searchParams.get(key);
    if (value && !DATE_RE.test(value)) {
      return badRequest(`${key} must be a date in YYYY-MM-DD format`);
    }
  }

  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200,
  );
  const offset = Math.max(
    parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
    0,
  );

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_list_events", {
    p_year: year,
    p_region: url.searchParams.get("region"),
    p_country: url.searchParams.get("country"),
    p_industry: url.searchParams.get("industry"),
    p_q: url.searchParams.get("q"),
    p_starts_after: url.searchParams.get("starts_after"),
    p_starts_before: url.searchParams.get("starts_before"),
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    console.error("GET /api/v1/events failed", error);
    void logApiUsage(auth, {
      endpoint: "GET /api/v1/events",
      statusCode: 500,
      creditsUsed: 0,
      request,
    });
    return serverError();
  }

  void logApiUsage(auth, {
    endpoint: "GET /api/v1/events",
    statusCode: 200,
    creditsUsed: 0,
    request,
  });

  return NextResponse.json(
    { data },
    { headers: { "X-RateLimit-Remaining": String(rateRemaining) } },
  );
}
