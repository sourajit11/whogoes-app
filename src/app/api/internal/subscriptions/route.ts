import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface PatchBody {
  event_id?: unknown;
  auto_unlock_enabled?: unknown;
  max_unlocks_per_event?: unknown;
  is_paused?: unknown;
}

/**
 * PATCH /api/internal/subscriptions
 * Cookie-authenticated. Used by the dashboard to flip auto-unlock or
 * change the per-event cap from the event detail page.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PatchBody;

  const eventId = body.event_id;
  if (typeof eventId !== "string" || eventId.length === 0) {
    return NextResponse.json(
      { error: "event_id is required" },
      { status: 400 },
    );
  }

  let autoUnlock: boolean | null = null;
  if (body.auto_unlock_enabled !== undefined) {
    if (typeof body.auto_unlock_enabled !== "boolean") {
      return NextResponse.json(
        { error: "auto_unlock_enabled must be boolean" },
        { status: 400 },
      );
    }
    autoUnlock = body.auto_unlock_enabled;
  }

  let cap: number | null = null;
  if (body.max_unlocks_per_event !== undefined) {
    if (body.max_unlocks_per_event === null) {
      cap = null;
    } else {
      const n = Number(body.max_unlocks_per_event);
      if (!Number.isInteger(n) || n < 0) {
        return NextResponse.json(
          { error: "max_unlocks_per_event must be a non-negative integer or null" },
          { status: 400 },
        );
      }
      cap = n;
    }
  }

  let paused: boolean | null = null;
  if (body.is_paused !== undefined) {
    if (typeof body.is_paused !== "boolean") {
      return NextResponse.json(
        { error: "is_paused must be boolean" },
        { status: 400 },
      );
    }
    paused = body.is_paused;
  }

  // api_upsert_subscription trusts p_user_id, so it is service-role-only in
  // the DB; the session check above is what authorizes this call.
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_upsert_subscription", {
    p_user_id: user.id,
    p_event_id: eventId,
    p_auto_unlock_enabled: autoUnlock,
    p_max_unlocks_per_event: cap,
    p_is_paused: paused,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
