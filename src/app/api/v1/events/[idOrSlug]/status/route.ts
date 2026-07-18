import { NextRequest, NextResponse } from "next/server";
import { gateRequest } from "@/lib/api/handler";
import { notFound, serverError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiUsage } from "@/lib/api/usage-logger";
import { resolveEventId } from "@/lib/api/event-resolver";

interface RouteParams {
  params: Promise<{ idOrSlug: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const gate = await gateRequest(request);
  if (gate instanceof NextResponse) return gate;
  const { auth, rateRemaining } = gate;

  const { idOrSlug } = await params;
  const eventId = await resolveEventId(idOrSlug);
  if (!eventId) {
    void logApiUsage(auth, {
      endpoint: `GET /api/v1/events/${idOrSlug}/status`,
      statusCode: 404,
      creditsUsed: 0,
      request,
    });
    return notFound("Event not found");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_get_event_unlock_status", {
    p_user_id: auth.userId,
    p_event_id: eventId,
  });

  if (error) {
    void logApiUsage(auth, {
      endpoint: `GET /api/v1/events/${idOrSlug}/status`,
      statusCode: 500,
      creditsUsed: 0,
      request,
    });
    return serverError();
  }

  void logApiUsage(auth, {
    endpoint: `GET /api/v1/events/${idOrSlug}/status`,
    statusCode: 200,
    creditsUsed: 0,
    request,
  });

  return NextResponse.json(
    { data },
    { headers: { "X-RateLimit-Remaining": String(rateRemaining) } },
  );
}
