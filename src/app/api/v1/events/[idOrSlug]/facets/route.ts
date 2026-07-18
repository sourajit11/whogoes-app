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
 * GET /api/v1/events/{idOrSlug}/facets
 *
 * Live filter counts: matched, with_email, owned (contacts you already
 * unlocked, so you never pay twice), and the by_* breakdowns. Free. Use this
 * before unlocking to see exactly what a filter set matches and costs.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const gate = await gateRequest(request);
  if (gate instanceof NextResponse) return gate;
  const { auth, rateRemaining } = gate;

  const { idOrSlug } = await params;
  const eventId = await resolveEventId(idOrSlug);
  if (!eventId) return notFound("Event not found");

  const parsed = parseFilterParams(new URL(request.url).searchParams);
  if ("error" in parsed) return badRequest(parsed.error);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_get_event_filter_facets", {
    p_user_id: auth.userId,
    p_event_id: eventId,
    p_filters: parsed.filters,
  });

  if (error) {
    console.error("GET facets failed", error);
    void logApiUsage(auth, {
      endpoint: `GET /api/v1/events/${idOrSlug}/facets`,
      statusCode: 500,
      creditsUsed: 0,
      request,
    });
    return serverError();
  }

  void logApiUsage(auth, {
    endpoint: `GET /api/v1/events/${idOrSlug}/facets`,
    statusCode: 200,
    creditsUsed: 0,
    request,
  });

  return NextResponse.json(
    { data },
    { headers: { "X-RateLimit-Remaining": String(rateRemaining) } },
  );
}
