import { NextRequest, NextResponse } from "next/server";
import { gateRequest } from "@/lib/api/handler";
import { badRequest, notFound, serverError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiUsage } from "@/lib/api/usage-logger";
import { resolveEventId } from "@/lib/api/event-resolver";
import { parseFilterParams } from "@/lib/api/filters";

interface RouteParams {
  params: Promise<{ idOrSlug: string }>;
}

/**
 * GET /api/v1/events/{idOrSlug}/preview
 *
 * Redacted sample of contacts matching the filters (no emails, partial
 * identities). Free. The same preview the event page shows before unlocking.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const gate = await gateRequest(request);
  if (gate instanceof NextResponse) return gate;
  const { auth, rateRemaining } = gate;

  const { idOrSlug } = await params;
  const eventId = await resolveEventId(idOrSlug);
  if (!eventId) return notFound("Event not found");

  const url = new URL(request.url);
  const parsed = parseFilterParams(url.searchParams);
  if ("error" in parsed) return badRequest(parsed.error);

  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "10", 10) || 10, 1),
    25,
  );

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_event_filter_preview", {
    p_event_id: eventId,
    p_filters: parsed.filters,
    p_limit: limit,
  });

  if (error) {
    console.error("GET preview failed", error);
    void logApiUsage(auth, {
      endpoint: `GET /api/v1/events/${idOrSlug}/preview`,
      statusCode: 500,
      creditsUsed: 0,
      request,
    });
    return serverError();
  }

  void logApiUsage(auth, {
    endpoint: `GET /api/v1/events/${idOrSlug}/preview`,
    statusCode: 200,
    creditsUsed: 0,
    request,
  });

  return NextResponse.json(
    { data },
    { headers: { "X-RateLimit-Remaining": String(rateRemaining) } },
  );
}
