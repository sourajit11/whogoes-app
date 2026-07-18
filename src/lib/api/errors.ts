import { NextResponse } from "next/server";
import type { ApiErrorBody } from "./types";

export function apiError(
  status: number,
  code: string,
  message: string,
  extraHeaders?: Record<string, string>,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: extraHeaders },
  );
}

export function unauthorized(message = "Invalid or missing API key") {
  return apiError(401, "UNAUTHORIZED", message);
}

export function paymentRequired(
  message = "Paid plan required",
  extraHeaders?: Record<string, string>,
) {
  return apiError(402, "PAYMENT_REQUIRED", message, extraHeaders);
}

export function forbidden(message = "Access denied") {
  return apiError(403, "FORBIDDEN", message);
}

export function notFound(message = "Resource not found") {
  return apiError(404, "NOT_FOUND", message);
}

export function badRequest(message: string) {
  return apiError(400, "BAD_REQUEST", message);
}

export function rateLimited() {
  return apiError(429, "RATE_LIMITED", "Too many requests. Try again shortly.");
}

export function spendCapExceeded(retryAfterSeconds: number) {
  return apiError(
    402,
    "SPEND_CAP_EXCEEDED",
    "Daily credit cap reached for this API key. Resets at UTC midnight.",
    { "Retry-After": String(retryAfterSeconds) },
  );
}

export function serverError(message = "Internal server error") {
  return apiError(500, "INTERNAL_ERROR", message);
}
