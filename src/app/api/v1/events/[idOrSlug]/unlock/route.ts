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
import { MAX_COUNT_PER_REQUEST, runChunkedUnlock } from "@/lib/api/unlock";

export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ idOrSlug: string }>;
}

interface UnlockBody {
  count?: unknown;
  filters?: unknown;
  include_emails?: unknown;
  auto_pull?: unknown;
  auto_pull_max_credits_per_day?: unknown;
}

/**
 * POST /api/v1/events/{idOrSlug}/unlock
 *
 * Unlock up to `count` contacts, best (email-verified, most recent) first.
 * Pricing: no ICP filters (has_email alone does not count) = 1 credit per
 * contact with verified email included; with ICP filters = 1 credit per
 * identity plus, when include_emails (default true), 1 credit per contact
 * that has a verified email, all charged in this one call.
 *
 * auto_pull: true additionally saves these filters as the event's pull rule,
 * so the caller's scheduled POST /api/v1/pull runs keep buying new matches.
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

  let body: UnlockBody;
  try {
    body = (await request.json()) as UnlockBody;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const count = body.count;
  if (
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_COUNT_PER_REQUEST
  ) {
    return badRequest(
      `count must be an integer between 1 and ${MAX_COUNT_PER_REQUEST}`,
    );
  }

  const parsed = validateFiltersBody(body.filters);
  if ("error" in parsed) return badRequest(parsed.error);
  const filters = parsed.filters;

  if (body.include_emails !== undefined && typeof body.include_emails !== "boolean") {
    return badRequest("include_emails must be a boolean");
  }
  const includeEmails = body.include_emails !== false;

  if (body.auto_pull !== undefined && typeof body.auto_pull !== "boolean") {
    return badRequest("auto_pull must be a boolean");
  }
  const autoPull = body.auto_pull === true;

  let autoPullDayCap: number | null = null;
  if (body.auto_pull_max_credits_per_day !== undefined) {
    const cap = body.auto_pull_max_credits_per_day;
    if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 0) {
      return badRequest("auto_pull_max_credits_per_day must be an integer >= 0");
    }
    autoPullDayCap = cap;
  }

  const spend = await getSpendCapState(auth.apiKeyId, auth.dailyCreditCap);
  if (spend.exceeded) {
    return spendCapExceeded(spend.retryAfterSeconds);
  }

  const result = await runChunkedUnlock({
    userId: auth.userId,
    eventId,
    count,
    filters,
    includeEmails,
    maxCredits: spend.remaining,
  });

  if ("rpcError" in result) {
    console.error("POST unlock failed", result.rpcError);
    void logApiUsage(auth, {
      endpoint: `POST /api/v1/events/${idOrSlug}/unlock`,
      statusCode: 500,
      creditsUsed: 0,
      request,
      idempotencyKey,
    });
    return serverError();
  }

  // The auto-pull rule is saved regardless of whether this unlock delivered
  // rows: "everything is owned today" is exactly when a rule matters most.
  let autoPullRule: unknown = null;
  if (autoPull) {
    const admin = createAdminClient();
    const { data: ruleData, error: ruleError } = await admin.rpc(
      "api_upsert_pull_rule",
      {
        p_user_id: auth.userId,
        p_event_id: eventId,
        p_filters: filters,
        p_include_emails: includeEmails,
        p_max_credits_per_day: autoPullDayCap,
        p_max_total: null,
        p_paused: null,
        p_enabled: true,
      },
    );
    if (ruleError) {
      console.error("auto_pull rule upsert failed", ruleError);
    } else {
      autoPullRule = (ruleData as { rule?: unknown })?.rule ?? null;
    }
  }

  const responseBody = {
    ...result,
    ...(autoPull ? { auto_pull: autoPullRule } : {}),
  };
  const statusCode = result.success ? 200 : 400;

  void logApiUsage(auth, {
    endpoint: `POST /api/v1/events/${idOrSlug}/unlock`,
    statusCode,
    creditsUsed: result.credits_spent,
    request,
    idempotencyKey,
    responseBody,
  });

  return NextResponse.json(
    { data: responseBody },
    {
      status: statusCode,
      headers: { "X-RateLimit-Remaining": String(rateRemaining) },
    },
  );
}
