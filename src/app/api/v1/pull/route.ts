import { NextRequest, NextResponse } from "next/server";
import { gateRequest } from "@/lib/api/handler";
import { badRequest, serverError, spendCapExceeded } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { findIdempotentResponse, logApiUsage } from "@/lib/api/usage-logger";
import { getSpendCapState } from "@/lib/api/spend-cap";

export const maxDuration = 60;

interface PullBody {
  max_credits?: unknown;
  dry_run?: unknown;
}

/**
 * POST /api/v1/pull
 *
 * Run all your auto-pull rules right now: each enabled rule unlocks newly
 * arrived contacts matching its filters, priced exactly like a manual unlock,
 * within its per-rule caps. dry_run: true estimates without charging.
 * The server also runs these rules automatically about every 30 minutes.
 */
export async function POST(request: NextRequest) {
  const gate = await gateRequest(request);
  if (gate instanceof NextResponse) return gate;
  const { auth, rateRemaining } = gate;

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

  let body: PullBody = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text) as PullBody;
  } catch {
    return badRequest("Invalid JSON body");
  }

  let maxCredits: number | null = null;
  if (body.max_credits !== undefined) {
    if (
      typeof body.max_credits !== "number" ||
      !Number.isInteger(body.max_credits) ||
      body.max_credits < 1
    ) {
      return badRequest("max_credits must be an integer >= 1");
    }
    maxCredits = body.max_credits;
  }

  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    return badRequest("dry_run must be a boolean");
  }
  const dryRun = body.dry_run === true;

  const spend = await getSpendCapState(auth.apiKeyId, auth.dailyCreditCap);
  if (!dryRun && spend.exceeded) {
    return spendCapExceeded(spend.retryAfterSeconds);
  }
  if (spend.remaining !== null) {
    maxCredits =
      maxCredits === null
        ? spend.remaining
        : Math.min(maxCredits, spend.remaining);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_run_pull_rules", {
    p_user_id: auth.userId,
    p_max_credits: maxCredits,
    p_dry_run: dryRun,
  });

  if (error) {
    console.error("POST /api/v1/pull failed", error);
    void logApiUsage(auth, {
      endpoint: "POST /api/v1/pull",
      statusCode: 500,
      creditsUsed: 0,
      request,
      idempotencyKey,
    });
    return serverError();
  }

  const result = data as { success: boolean; credits_spent?: number };
  const statusCode = result.success ? 200 : 400;

  void logApiUsage(auth, {
    endpoint: "POST /api/v1/pull",
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
