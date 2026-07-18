import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/api/auth";

const MAX_KEYS_PER_USER = 5;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Paid-tier gate.
  const { data: eligible, error: eligibleErr } = await supabase.rpc(
    "is_api_eligible",
    { p_user_id: user.id },
  );
  if (eligibleErr) {
    return NextResponse.json(
      { error: "Failed to check eligibility" },
      { status: 500 },
    );
  }
  if (!eligible) {
    return NextResponse.json(
      {
        error:
          "API access requires a paid plan. Purchase credits at /dashboard/billing.",
      },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    daily_credit_cap?: unknown;
  };
  const name =
    typeof body.name === "string" && body.name.trim().length > 0
      ? body.name.trim().slice(0, 60)
      : "Default";

  let dailyCreditCap: number | null = null;
  if (body.daily_credit_cap !== undefined && body.daily_credit_cap !== null) {
    const n = Number(body.daily_credit_cap);
    if (!Number.isInteger(n) || n < 0) {
      return NextResponse.json(
        { error: "daily_credit_cap must be a non-negative integer or null" },
        { status: 400 },
      );
    }
    dailyCreditCap = n;
  }

  const { count } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_active", true);

  if ((count ?? 0) >= MAX_KEYS_PER_USER) {
    return NextResponse.json(
      { error: `Maximum ${MAX_KEYS_PER_USER} active API keys allowed` },
      { status: 400 },
    );
  }

  const { rawKey, keyHash, keyPrefix } = await generateApiKey();

  const { data: inserted, error } = await supabase
    .from("api_keys")
    .insert({
      user_id: user.id,
      name,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      daily_credit_cap: dailyCreditCap,
    })
    .select(
      "id, name, key_prefix, is_active, daily_credit_cap, created_at, last_used_at, revoked_at",
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rawKey, key: inserted });
}

// PATCH: update a key's daily_credit_cap or name.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    daily_credit_cap?: unknown;
  };
  if (!body.id || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim().length > 0) {
    updates.name = body.name.trim().slice(0, 60);
  }
  if (body.daily_credit_cap !== undefined) {
    if (body.daily_credit_cap === null) {
      updates.daily_credit_cap = null;
    } else {
      const n = Number(body.daily_credit_cap);
      if (!Number.isInteger(n) || n < 0) {
        return NextResponse.json(
          { error: "daily_credit_cap must be a non-negative integer or null" },
          { status: 400 },
        );
      }
      updates.daily_credit_cap = n;
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("api_keys")
    .update(updates)
    .eq("id", body.id)
    .eq("user_id", user.id)
    .select(
      "id, name, key_prefix, is_active, daily_credit_cap, created_at, last_used_at, revoked_at",
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ key: data });
}

