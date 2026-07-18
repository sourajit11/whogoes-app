import type { NextRequest, NextResponse } from "next/server";
import {
  authenticateApiKey,
  isAuthFailure,
  type AuthFailure,
} from "./auth";
import { checkRateLimit } from "./rate-limit";
import {
  paymentRequired,
  rateLimited,
  unauthorized,
} from "./errors";
import type { AuthenticatedRequest } from "./types";

export interface AuthGate {
  auth: AuthenticatedRequest;
  rateRemaining: number;
}

/**
 * Run all common gates: bearer auth, paid check, rate limit.
 * Returns either { auth, rateRemaining } on success, or a NextResponse to return.
 */
export async function gateRequest(
  request: NextRequest,
): Promise<AuthGate | NextResponse> {
  const result = await authenticateApiKey(request.headers.get("Authorization"));

  if (isAuthFailure(result)) {
    return mapFailureToResponse(result);
  }

  const rate = checkRateLimit(result.apiKeyId);
  if (!rate.allowed) {
    return rateLimited();
  }

  return { auth: result, rateRemaining: rate.remaining };
}

function mapFailureToResponse(failure: AuthFailure): NextResponse {
  switch (failure.kind) {
    case "missing":
      return unauthorized("Missing API key. Use 'Authorization: Bearer <key>'.");
    case "invalid":
      return unauthorized("Invalid or revoked API key.");
    case "not_paid":
      return paymentRequired(
        "API access requires a paid plan. Upgrade at /dashboard/billing.",
      );
  }
}
