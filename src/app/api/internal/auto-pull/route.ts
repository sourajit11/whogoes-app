import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const USER_BATCH = 25;
const SOFT_DEADLINE_MS = 50_000;

/**
 * Auto-pull drainer, protected by ?secret=AUTO_PULL_CRON_SECRET.
 *
 * DORMANT since 2026-07-18: the launched model is customer-driven (customers
 * schedule POST /api/v1/pull themselves so every charge maps to their own
 * call). The n8n schedule (workflow siNGEfwdKUFF9IdX) is DEACTIVATED. This
 * route stays as the ready-made engine for a future opt-in "fully managed"
 * mode; activating that workflow turns server-side sweeps back on.
 *
 * Walks users with enabled, unpaused pull rules (least recently drained
 * first) and runs api_run_pull_rules for each: new contacts matching each
 * rule's filters get unlocked and charged exactly like a manual unlock,
 * within per-rule daily caps and the user's balance. Spend is logged to
 * api_usage_log with api_key_id NULL (cron runs are not tied to a key, so
 * per-key daily caps do not apply; the per-rule cap is the control).
 */
async function drain(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (
    !process.env.AUTO_PULL_CRON_SECRET ||
    secret !== process.env.AUTO_PULL_CRON_SECRET
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const admin = createAdminClient();

  const { data: users, error: usersError } = await admin.rpc(
    "api_list_pull_due_users",
    { p_limit: USER_BATCH },
  );
  if (usersError) {
    console.error("auto-pull drainer: listing due users failed", usersError);
    return NextResponse.json({ error: "list_failed" }, { status: 500 });
  }

  let processed = 0;
  let totalUnlocked = 0;
  let totalCredits = 0;
  const failures: string[] = [];

  for (const row of (users ?? []) as { user_id: string }[]) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) break;

    try {
      const { data, error } = await admin.rpc("api_run_pull_rules", {
        p_user_id: row.user_id,
        p_max_credits: null,
        p_dry_run: false,
      });
      if (error) throw new Error(error.message);

      const result = data as {
        credits_spent?: number;
        contacts_unlocked?: number;
        breakdown?: unknown;
      };
      processed += 1;
      totalUnlocked += result.contacts_unlocked ?? 0;
      totalCredits += result.credits_spent ?? 0;

      if ((result.credits_spent ?? 0) > 0) {
        await admin.from("api_usage_log").insert({
          api_key_id: null,
          user_id: row.user_id,
          endpoint: "CRON /api/internal/auto-pull",
          method: "POST",
          status_code: 200,
          credits_used: result.credits_spent ?? 0,
          response_body: { breakdown: result.breakdown ?? [] },
        });
      }
    } catch (err) {
      console.error(`auto-pull drainer: user ${row.user_id} failed`, err);
      failures.push(row.user_id);
      try {
        await admin.from("api_usage_log").insert({
          api_key_id: null,
          user_id: row.user_id,
          endpoint: "CRON /api/internal/auto-pull",
          method: "POST",
          status_code: 500,
          credits_used: 0,
        });
      } catch {
        // Logging must never break the loop.
      }
    }
  }

  return NextResponse.json({
    processed,
    contacts_unlocked: totalUnlocked,
    credits_spent: totalCredits,
    failures,
    duration_ms: Date.now() - startedAt,
  });
}

export async function GET(request: NextRequest) {
  return drain(request);
}

export async function POST(request: NextRequest) {
  return drain(request);
}
