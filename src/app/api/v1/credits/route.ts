import { NextRequest, NextResponse } from "next/server";
import { gateRequest } from "@/lib/api/handler";
import { serverError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiUsage } from "@/lib/api/usage-logger";

/**
 * GET /api/v1/credits
 *
 * Current credit balance plus this key's daily spend cap state.
 */
export async function GET(request: NextRequest) {
  const gate = await gateRequest(request);
  if (gate instanceof NextResponse) return gate;
  const { auth, rateRemaining } = gate;

  const admin = createAdminClient();
  const [balanceRes, spentRes] = await Promise.all([
    admin.rpc("api_get_user_credits", { p_user_id: auth.userId }),
    admin.rpc("api_daily_credit_spend", { p_api_key_id: auth.apiKeyId }),
  ]);

  if (balanceRes.error) {
    void logApiUsage(auth, {
      endpoint: "GET /api/v1/credits",
      statusCode: 500,
      creditsUsed: 0,
      request,
    });
    return serverError();
  }

  const spentToday = (spentRes.data as number | null) ?? 0;
  const cap = auth.dailyCreditCap;

  void logApiUsage(auth, {
    endpoint: "GET /api/v1/credits",
    statusCode: 200,
    creditsUsed: 0,
    request,
  });

  return NextResponse.json(
    {
      data: {
        balance: (balanceRes.data as number | null) ?? 0,
        daily_cap: cap,
        spent_today: spentToday,
        remaining_today: cap === null ? null : Math.max(0, cap - spentToday),
      },
    },
    { headers: { "X-RateLimit-Remaining": String(rateRemaining) } },
  );
}
