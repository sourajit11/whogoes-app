import { createAdminClient } from "@/lib/supabase/admin";
import type { NextRequest } from "next/server";
import type { AuthenticatedRequest } from "./types";

export interface LogOptions {
  endpoint: string;
  statusCode: number;
  creditsUsed: number;
  request: NextRequest;
  idempotencyKey?: string | null;
  responseBody?: unknown;
}

/**
 * Insert an api_usage_log row. Used both for auditing and as the
 * idempotency cache: if `idempotencyKey` is set, retries will look up
 * this row by `(api_key_id, idempotency_key)`.
 *
 * Fire-and-forget; never throws.
 */
export async function logApiUsage(
  auth: AuthenticatedRequest,
  opts: LogOptions,
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("api_usage_log").insert({
      api_key_id: auth.apiKeyId,
      user_id: auth.userId,
      endpoint: opts.endpoint,
      method: opts.request.method,
      status_code: opts.statusCode,
      credits_used: opts.creditsUsed,
      request_ip:
        opts.request.headers.get("x-forwarded-for") ??
        opts.request.headers.get("x-real-ip") ??
        null,
      idempotency_key: opts.idempotencyKey ?? null,
      response_body: opts.responseBody ?? null,
    });
  } catch (err) {
    console.error("logApiUsage failed", err);
  }
}

export interface CachedResponse {
  status_code: number;
  credits_used: number;
  response_body: unknown;
}

/**
 * Look up a previously logged response for an idempotency key.
 * Returns the cached response or null.
 */
export async function findIdempotentResponse(
  apiKeyId: string,
  idempotencyKey: string,
): Promise<CachedResponse | null> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("api_usage_log")
      .select("status_code, credits_used, response_body")
      .eq("api_key_id", apiKeyId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (!data) return null;
    return data as CachedResponse;
  } catch {
    return null;
  }
}
