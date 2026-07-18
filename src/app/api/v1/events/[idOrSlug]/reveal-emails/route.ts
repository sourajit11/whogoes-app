import { NextRequest, NextResponse } from "next/server";
import { gateRequest } from "@/lib/api/handler";
import {
  badRequest,
  notFound,
  serverError,
  spendCapExceeded,
} from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { findIdempotentResponse, logApiUsage } from "@/lib/api/usage-logger";
import { resolveEventId } from "@/lib/api/event-resolver";
import { getSpendCapState } from "@/lib/api/spend-cap";
import { validateFiltersBody } from "@/lib/api/filters";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: Promise<{ idOrSlug: string }>;
}

interface RevealBody {
  contact_ids?: unknown;
  filters?: unknown;
}

/**
 * POST /api/v1/events/{idOrSlug}/reveal-emails
 *
 * Reveal verified emails for contacts you already unlocked without emails:
 * 1 credit per email actually revealed. Scope with contact_ids, with filters,
 * or with neither to reveal every eligible contact on the event. Contacts
 * whose email is already unlocked are never charged again.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const gate = await gateRequest(request);
  if (gate instanceof NextResponse) return gate;
  const { auth, rateRemaining } = gate;

  const { idOrSlug } = await params;
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || null;

  if (idempotencyKey) {
    const cached = await findIdempotentResponse(auth.apiKeyId, idempotencyKey);
    if (cached) {
      return NextResponse.json(
        { data: cached.response_body },
        {
          status: cached.status_code,
          headers: {
            "X-RateLimit-Remaining": String(rateRemaining),
            "Idempotency-Replayed": "true",
          },
        },
      );
    }
  }

  const eventId = await resolveEventId(idOrSlug);
  if (!eventId) return notFound("Event not found");

  let body: RevealBody = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text) as RevealBody;
  } catch {
    return badRequest("Invalid JSON body");
  }

  let contactIds: string[] | null = null;
  if (body.contact_ids !== undefined) {
    if (
      !Array.isArray(body.contact_ids) ||
      body.contact_ids.some((v) => typeof v !== "string" || !UUID_RE.test(v))
    ) {
      return badRequest("contact_ids must be an array of contact UUIDs");
    }
    if (body.contact_ids.length > 1000) {
      return badRequest("contact_ids supports at most 1000 ids per call");
    }
    contactIds = body.contact_ids as string[];
  }

  const parsed = validateFiltersBody(body.filters);
  if ("error" in parsed) return badRequest(parsed.error);

  const spend = await getSpendCapState(auth.apiKeyId, auth.dailyCreditCap);
  if (spend.exceeded) {
    return spendCapExceeded(spend.retryAfterSeconds);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_reveal_event_emails", {
    p_user_id: auth.userId,
    p_event_id: eventId,
    p_contact_ids: contactIds,
    p_filters: parsed.filters,
    p_max_credits: spend.remaining,
  });

  if (error) {
    console.error("POST reveal-emails failed", error);
    void logApiUsage(auth, {
      endpoint: `POST /api/v1/events/${idOrSlug}/reveal-emails`,
      statusCode: 500,
      creditsUsed: 0,
      request,
      idempotencyKey,
    });
    return serverError();
  }

  const result = data as {
    success: boolean;
    credits_spent?: number;
  };
  const statusCode = result.success ? 200 : 400;

  void logApiUsage(auth, {
    endpoint: `POST /api/v1/events/${idOrSlug}/reveal-emails`,
    statusCode,
    creditsUsed: result.credits_spent ?? 0,
    request,
    idempotencyKey,
    responseBody: result,
  });

  return NextResponse.json(
    { data: result },
    {
      status: statusCode,
      headers: { "X-RateLimit-Remaining": String(rateRemaining) },
    },
  );
}
