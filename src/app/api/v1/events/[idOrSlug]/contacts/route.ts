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

const SORT_KEYS = [
  "unlocked_at",
  "full_name",
  "current_title",
  "company_name",
  "post_date",
  "email",
];

/**
 * GET /api/v1/events/{idOrSlug}/contacts
 *
 * Your unlocked contacts for one event. Free. Emails appear only on contacts
 * whose email tier is unlocked (email_unlocked: true); has_email tells you
 * whether a reveal would return one. Accepts the standard filter params plus
 * sort/dir. Unlocking is POST /unlock; this endpoint only reads.
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
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1),
    100,
  );
  const offset = Math.max(
    parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
    0,
  );

  const sort = url.searchParams.get("sort") ?? "unlocked_at";
  if (!SORT_KEYS.includes(sort)) {
    return badRequest(`sort must be one of: ${SORT_KEYS.join(", ")}`);
  }
  const dir = url.searchParams.get("dir") ?? "desc";
  if (dir !== "asc" && dir !== "desc") {
    return badRequest("dir must be asc or desc");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_get_unlocked_contacts", {
    p_user_id: auth.userId,
    p_event_id: eventId,
    p_filters: parsed.filters,
    p_limit: limit,
    p_offset: offset,
    p_sort_key: sort,
    p_sort_dir: dir,
  });

  if (error) {
    console.error("GET event contacts failed", error);
    void logApiUsage(auth, {
      endpoint: `GET /api/v1/events/${idOrSlug}/contacts`,
      statusCode: 500,
      creditsUsed: 0,
      request,
    });
    return serverError();
  }

  void logApiUsage(auth, {
    endpoint: `GET /api/v1/events/${idOrSlug}/contacts`,
    statusCode: 200,
    creditsUsed: 0,
    request,
  });

  return NextResponse.json(
    { data },
    { headers: { "X-RateLimit-Remaining": String(rateRemaining) } },
  );
}
