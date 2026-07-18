import { NextRequest, NextResponse } from "next/server";
import { gateRequest } from "@/lib/api/handler";
import { badRequest, notFound, serverError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiUsage } from "@/lib/api/usage-logger";
import { resolveEventId } from "@/lib/api/event-resolver";
import { validateFiltersBody, type Filters } from "@/lib/api/filters";

interface RouteParams {
  params: Promise<{ idOrSlug: string }>;
}

interface RuleBody {
  filters?: unknown;
  include_emails?: unknown;
  max_credits_per_day?: unknown;
  max_total_contacts?: unknown;
  paused?: unknown;
  enabled?: unknown;
}

interface RuleRpcArgs {
  p_user_id: string;
  p_event_id: string;
  p_filters: Filters | null;
  p_include_emails: boolean | null;
  p_max_credits_per_day: number | null;
  p_max_total: number | null;
  p_paused: boolean | null;
  p_enabled: boolean | null;
}

/**
 * Cap fields accept an integer >= 0, or JSON null to remove the cap (the RPC
 * uses -1 as its "clear" sentinel; NULL there means "keep current value").
 */
function parseCap(
  body: RuleBody,
  key: "max_credits_per_day" | "max_total_contacts",
): { value: number | null } | { error: string } {
  if (!(key in body)) return { value: null };
  const raw = body[key];
  if (raw === null) return { value: -1 };
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    return { error: `${key} must be an integer >= 0, or null to remove the cap` };
  }
  return { value: raw };
}

async function upsertRule(
  request: NextRequest,
  idOrSlug: string,
  replace: boolean,
) {
  const gate = await gateRequest(request);
  if (gate instanceof NextResponse) return gate;
  const { auth, rateRemaining } = gate;

  const eventId = await resolveEventId(idOrSlug);
  if (!eventId) return notFound("Event not found");

  let body: RuleBody = {};
  try {
    const text = await request.text();
    if (text.trim().length > 0) body = JSON.parse(text) as RuleBody;
  } catch {
    return badRequest("Invalid JSON body");
  }

  for (const key of ["include_emails", "paused", "enabled"] as const) {
    if (body[key] !== undefined && typeof body[key] !== "boolean") {
      return badRequest(`${key} must be a boolean`);
    }
  }

  const dayCap = parseCap(body, "max_credits_per_day");
  if ("error" in dayCap) return badRequest(dayCap.error);
  const totalCap = parseCap(body, "max_total_contacts");
  if ("error" in totalCap) return badRequest(totalCap.error);

  let filters: Filters | null = null;
  if (body.filters !== undefined || replace) {
    const parsed = validateFiltersBody(body.filters);
    if ("error" in parsed) return badRequest(parsed.error);
    filters = parsed.filters;
  }

  // PUT replaces the whole rule (absent fields get their defaults); PATCH
  // passes NULL for absent fields so the RPC keeps current values.
  const args: RuleRpcArgs = replace
    ? {
        p_user_id: auth.userId,
        p_event_id: eventId,
        p_filters: filters ?? {},
        p_include_emails: (body.include_emails as boolean | undefined) ?? true,
        p_max_credits_per_day: dayCap.value ?? -1,
        p_max_total: totalCap.value ?? -1,
        p_paused: (body.paused as boolean | undefined) ?? false,
        p_enabled: (body.enabled as boolean | undefined) ?? true,
      }
    : {
        p_user_id: auth.userId,
        p_event_id: eventId,
        p_filters: filters,
        p_include_emails: (body.include_emails as boolean | undefined) ?? null,
        p_max_credits_per_day: dayCap.value,
        p_max_total: totalCap.value,
        p_paused: (body.paused as boolean | undefined) ?? null,
        p_enabled: (body.enabled as boolean | undefined) ?? null,
      };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_upsert_pull_rule", args);

  const endpoint = `${request.method} /api/v1/auto-pull/${idOrSlug}`;
  if (error) {
    console.error("auto-pull upsert failed", error);
    void logApiUsage(auth, {
      endpoint,
      statusCode: 500,
      creditsUsed: 0,
      request,
    });
    return serverError();
  }

  const result = data as { success: boolean };
  const statusCode = result.success ? 200 : 400;
  void logApiUsage(auth, {
    endpoint,
    statusCode,
    creditsUsed: 0,
    request,
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

/** PUT /api/v1/auto-pull/{idOrSlug}: create or fully replace the event's rule. */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { idOrSlug } = await params;
  return upsertRule(request, idOrSlug, true);
}

/** PATCH /api/v1/auto-pull/{idOrSlug}: partial update; absent fields keep their value. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { idOrSlug } = await params;
  return upsertRule(request, idOrSlug, false);
}

/** DELETE /api/v1/auto-pull/{idOrSlug}: disable and reset the event's rule. */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const gate = await gateRequest(request);
  if (gate instanceof NextResponse) return gate;
  const { auth, rateRemaining } = gate;

  const { idOrSlug } = await params;
  const eventId = await resolveEventId(idOrSlug);
  if (!eventId) return notFound("Event not found");

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_delete_pull_rule", {
    p_user_id: auth.userId,
    p_event_id: eventId,
  });

  const endpoint = `DELETE /api/v1/auto-pull/${idOrSlug}`;
  if (error) {
    console.error("auto-pull delete failed", error);
    void logApiUsage(auth, {
      endpoint,
      statusCode: 500,
      creditsUsed: 0,
      request,
    });
    return serverError();
  }

  const result = data as { success: boolean; deleted: boolean };
  if (!result.deleted) {
    void logApiUsage(auth, {
      endpoint,
      statusCode: 404,
      creditsUsed: 0,
      request,
    });
    return notFound("No auto-pull rule exists for this event");
  }

  void logApiUsage(auth, {
    endpoint,
    statusCode: 200,
    creditsUsed: 0,
    request,
    responseBody: result,
  });

  return NextResponse.json(
    { data: result },
    { headers: { "X-RateLimit-Remaining": String(rateRemaining) } },
  );
}
