import { NextRequest, NextResponse } from "next/server";
import { gateRequest } from "@/lib/api/handler";
import { badRequest, notFound, serverError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiUsage } from "@/lib/api/usage-logger";
import { resolveEventId } from "@/lib/api/event-resolver";

/**
 * GET /api/v1/contacts
 *
 * All your unlocked contacts across every event, paginated. Free. This is the
 * incremental sync feed: pass `since` (the `watermark` from your previous
 * call) to get only contacts unlocked after that moment, oldest first, then
 * persist the new `watermark`. Without `since`, newest first.
 *
 * Query params:
 *   since  — ISO timestamp; strictly newer rows only
 *   event  — event UUID or slug to scope to one event
 *   limit  — default 50, max 200
 *   offset — default 0
 */
export async function GET(request: NextRequest) {
  const gate = await gateRequest(request);
  if (gate instanceof NextResponse) return gate;
  const { auth, rateRemaining } = gate;

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200,
  );
  const offset = Math.max(
    parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
    0,
  );

  const sinceParam = url.searchParams.get("since");
  let since: string | null = null;
  if (sinceParam) {
    if (Number.isNaN(new Date(sinceParam).getTime())) {
      return badRequest("since must be a valid ISO 8601 timestamp");
    }
    // Pass the raw value through: the watermark we hand out has microsecond
    // precision, and Date#toISOString would truncate it to milliseconds,
    // making `charged_at > since` re-match the final rows forever.
    since = sinceParam;
  }

  let eventId: string | null = null;
  const eventParam = url.searchParams.get("event");
  if (eventParam) {
    eventId = await resolveEventId(eventParam);
    if (!eventId) return notFound("Event not found");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_get_all_unlocked_contacts", {
    p_user_id: auth.userId,
    p_limit: limit,
    p_offset: offset,
    p_since: since,
    p_event_id: eventId,
  });

  if (error) {
    console.error("GET /api/v1/contacts failed", error);
    void logApiUsage(auth, {
      endpoint: "GET /api/v1/contacts",
      statusCode: 500,
      creditsUsed: 0,
      request,
    });
    return serverError();
  }

  void logApiUsage(auth, {
    endpoint: "GET /api/v1/contacts",
    statusCode: 200,
    creditsUsed: 0,
    request,
  });

  return NextResponse.json(
    { data },
    { headers: { "X-RateLimit-Remaining": String(rateRemaining) } },
  );
}
