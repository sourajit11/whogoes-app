import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthenticatedRequest } from "./types";

export async function hashApiKey(rawKey: string): Promise<string> {
  const data = new TextEncoder().encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type AuthFailure =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "not_paid" };

/**
 * Validate Bearer token. Returns the authenticated request on success,
 * or an AuthFailure indicating which 4xx to return.
 *
 * Defense-in-depth: even if a key was created when the user was paid,
 * we re-check `is_api_eligible` on every request. If they refund or
 * get flagged, all keys stop working immediately.
 */
export async function authenticateApiKey(
  authHeader: string | null,
): Promise<AuthenticatedRequest | AuthFailure> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { kind: "missing" };
  }

  const rawKey = authHeader.slice(7).trim();
  if (rawKey.length < 20) {
    return { kind: "invalid" };
  }

  const keyHash = await hashApiKey(rawKey);
  const admin = createAdminClient();

  const { data: keyRow, error } = await admin
    .from("api_keys")
    .select("id, user_id, is_active, daily_credit_cap")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !keyRow) {
    return { kind: "invalid" };
  }

  const { data: eligible } = await admin.rpc("is_api_eligible", {
    p_user_id: keyRow.user_id,
  });
  if (!eligible) {
    return { kind: "not_paid" };
  }

  // Fire-and-forget last_used_at update.
  void admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRow.id);

  return {
    userId: keyRow.user_id,
    apiKeyId: keyRow.id,
    dailyCreditCap: keyRow.daily_credit_cap,
  };
}

export function isAuthFailure(
  result: AuthenticatedRequest | AuthFailure,
): result is AuthFailure {
  return "kind" in result;
}

export async function generateApiKey(): Promise<{
  rawKey: string;
  keyHash: string;
  keyPrefix: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const rawKey = `wg_${hex}`;
  const keyHash = await hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 11);
  return { rawKey, keyHash, keyPrefix };
}
