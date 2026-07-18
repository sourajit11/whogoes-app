import { NextRequest, NextResponse } from "next/server";
import { gateRequest } from "@/lib/api/handler";
import { serverError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiUsage } from "@/lib/api/usage-logger";

/**
 * GET /api/v1/auto-pull
 *
 * List your auto-pull rules: one per event, with its filters, caps, spend
 * today and last run. Create or edit rules with PUT/PATCH
 * /api/v1/auto-pull/{event}, or by unlocking with auto_pull: true.
 */
export async function GET(request: NextRequest) {
  const gate = await gateRequest(request);
  if (gate instanceof NextResponse) return gate;
  const { auth, rateRemaining } = gate;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_list_pull_rules", {
    p_user_id: auth.userId,
  });

  if (error) {
    console.error("GET /api/v1/auto-pull failed", error);
    void logApiUsage(auth, {
      endpoint: "GET /api/v1/auto-pull",
      statusCode: 500,
      creditsUsed: 0,
      request,
    });
    return serverError();
  }

  void logApiUsage(auth, {
    endpoint: "GET /api/v1/auto-pull",
    statusCode: 200,
    creditsUsed: 0,
    request,
  });

  return NextResponse.json(
    { data },
    { headers: { "X-RateLimit-Remaining": String(rateRemaining) } },
  );
}
