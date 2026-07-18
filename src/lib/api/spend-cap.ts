import { createAdminClient } from "@/lib/supabase/admin";

export interface SpendCapState {
  cap: number | null;
  spent: number;
  remaining: number | null;
  exceeded: boolean;
  retryAfterSeconds: number;
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
  return Math.max(60, Math.floor((next.getTime() - now.getTime()) / 1000));
}

/**
 * Fetch the daily spend state for a key. NULL cap = unlimited.
 */
export async function getSpendCapState(
  apiKeyId: string,
  cap: number | null,
): Promise<SpendCapState> {
  const retryAfterSeconds = secondsUntilUtcMidnight();

  if (cap === null) {
    return {
      cap: null,
      spent: 0,
      remaining: null,
      exceeded: false,
      retryAfterSeconds,
    };
  }

  const admin = createAdminClient();
  const { data } = await admin.rpc("api_daily_credit_spend", {
    p_api_key_id: apiKeyId,
  });
  const spent = (data as number | null) ?? 0;
  const remaining = Math.max(0, cap - spent);

  return {
    cap,
    spent,
    remaining,
    exceeded: remaining <= 0,
    retryAfterSeconds,
  };
}
