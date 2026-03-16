# WhoGoes Public API — Implementation Plan

> Reference document for implementing a public REST API that lets users programmatically
> fetch event contacts using API keys, with automatic credit deduction.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Database Changes (SQL)](#3-database-changes-sql)
4. [New Files to Create](#4-new-files-to-create)
5. [Changes to Existing Files](#5-changes-to-existing-files)
6. [API Endpoint Reference](#6-api-endpoint-reference)
7. [Scenarios & Edge Cases](#7-scenarios--edge-cases)
8. [Security Considerations](#8-security-considerations)
9. [Step-by-Step Implementation Order](#9-step-by-step-implementation-order)
10. [Testing with curl](#10-testing-with-curl)
11. [Future Improvements](#11-future-improvements)

---

## 1. Architecture Overview

```
┌─────────────────┐     Bearer Token      ┌─────────────────────────┐
│  User's Server   │ ──────────────────►  │  Next.js API Routes     │
│  (API consumer)  │                       │  /api/v1/*              │
└─────────────────┘                       └────────┬────────────────┘
                                                    │
                                          1. Validate API key (hash lookup)
                                          2. Rate limit check
                                          3. Call Supabase RPC with user_id
                                                    │
                                          ┌─────────▼────────────────┐
                                          │  Supabase (PostgreSQL)    │
                                          │  - api_* RPCs             │
                                          │  - Service role client    │
                                          └──────────────────────────┘
```

**Why new RPCs?** Your existing RPCs (`unlock_event_contacts`, etc.) use `auth.uid()` to get
the current user. API requests don't have a Supabase session (no cookies), so `auth.uid()`
returns NULL. The solution: create `api_*` versions of these RPCs that accept `p_user_id` as
a parameter. These are called via a **service role** Supabase client (which bypasses RLS).
The API route handler authenticates the API key, looks up the user, and passes their ID.

---

## 2. Prerequisites

### Add Service Role Key

Get it from: **Supabase Dashboard > Settings > API > service_role key**

Add to `app/.env.local`:
```
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

> **IMPORTANT**: No `NEXT_PUBLIC_` prefix! This key must NEVER reach the browser.
> It bypasses all RLS (Row Level Security) policies.

---

## 3. Database Changes (SQL)

Create file: `app/sql/03-api-keys.sql`

Run this in **Supabase SQL Editor** after the existing migrations.

```sql
-- ============================================
-- WhoGoes Public API - Tables & RPCs
-- Run in Supabase SQL Editor AFTER 02-unlock-rpcs.sql
-- ============================================


-- ─────────────────────────────────────────────
-- TABLE: api_keys
-- Stores hashed API keys. Raw key shown once on creation.
-- ─────────────────────────────────────────────

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  key_prefix TEXT NOT NULL,             -- first 11 chars (e.g., "wg_a1b2c3d4")
  key_hash TEXT NOT NULL,               -- SHA-256 hash of the full key
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT api_keys_hash_unique UNIQUE (key_hash)
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Dashboard (cookie-auth) can manage own keys
CREATE POLICY "Users can read own api keys"
  ON api_keys FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own api keys"
  ON api_keys FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own api keys"
  ON api_keys FOR UPDATE USING (auth.uid() = user_id);

-- Fast lookup by hash for API auth
CREATE INDEX idx_api_keys_hash ON api_keys (key_hash) WHERE is_active = true;
CREATE INDEX idx_api_keys_user ON api_keys (user_id);


-- ─────────────────────────────────────────────
-- TABLE: api_usage_log
-- Audit trail for every API request.
-- ─────────────────────────────────────────────

CREATE TABLE api_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  request_ip TEXT,
  request_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  response_time_ms INTEGER
);

ALTER TABLE api_usage_log ENABLE ROW LEVEL SECURITY;

-- Users can view own usage in dashboard
CREATE POLICY "Users can read own usage logs"
  ON api_usage_log FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX idx_api_usage_key_time ON api_usage_log (api_key_id, request_timestamp DESC);
CREATE INDEX idx_api_usage_rate_limit ON api_usage_log (api_key_id, request_timestamp);


-- ─────────────────────────────────────────────
-- RPC: api_unlock_event_contacts
-- Same as unlock_event_contacts but accepts user_id parameter.
-- Called from server via service role key only.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api_unlock_event_contacts(
  p_user_id UUID,
  p_event_id UUID,
  p_count INTEGER
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_balance INTEGER;
  v_available_count INTEGER;
  v_actual_count INTEGER;
  v_new_balance INTEGER;
BEGIN
  -- Validate user
  IF p_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'User ID required');
  END IF;

  -- Check credits
  SELECT balance INTO v_balance FROM customer_credits WHERE user_id = p_user_id;
  IF v_balance IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'No credits account found');
  END IF;
  IF v_balance <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'No credits remaining', 'current_balance', 0);
  END IF;
  IF p_count <= 0 THEN
    RETURN json_build_object('success', false, 'message', 'Invalid count');
  END IF;

  -- Count available (not yet unlocked) contacts
  SELECT COUNT(*) INTO v_available_count
  FROM contacts c
  WHERE c.event_id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM customer_contact_access cca
      WHERE cca.user_id = p_user_id AND cca.contact_id = c.id AND cca.event_id = p_event_id
    );

  IF v_available_count = 0 THEN
    RETURN json_build_object('success', false, 'message', 'No more contacts to unlock');
  END IF;

  -- Unlock minimum of: requested, available, balance
  v_actual_count := LEAST(p_count, v_available_count, v_balance);

  -- Auto-subscribe
  INSERT INTO customer_event_subscriptions (user_id, event_id)
  VALUES (p_user_id, p_event_id)
  ON CONFLICT (user_id, event_id) DO NOTHING;

  -- Insert access records (email-verified first, then newest posts)
  INSERT INTO customer_contact_access (user_id, contact_id, event_id)
  SELECT p_user_id, c.id, p_event_id
  FROM contacts c
  WHERE c.event_id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM customer_contact_access cca
      WHERE cca.user_id = p_user_id AND cca.contact_id = c.id AND cca.event_id = p_event_id
    )
  ORDER BY
    (CASE WHEN c.email IS NOT NULL AND c.email != '' THEN 0 ELSE 1 END),
    c.post_date DESC NULLS LAST
  LIMIT v_actual_count;

  -- Deduct credits
  UPDATE customer_credits
  SET balance = balance - v_actual_count, updated_at = now()
  WHERE user_id = p_user_id;

  SELECT balance INTO v_new_balance FROM customer_credits WHERE user_id = p_user_id;

  RETURN json_build_object(
    'success', true,
    'message', v_actual_count || ' contacts unlocked',
    'credits_spent', v_actual_count,
    'new_balance', v_new_balance,
    'contacts_unlocked', v_actual_count
  );
END;
$$;


-- ─────────────────────────────────────────────
-- RPC: api_get_event_unlock_status
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api_get_event_unlock_status(p_user_id UUID, p_event_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_total INTEGER;
  v_with_email INTEGER;
  v_unlocked INTEGER := 0;
  v_balance INTEGER := 0;
  v_is_subscribed BOOLEAN := false;
BEGIN
  SELECT COUNT(*) INTO v_total FROM contacts WHERE event_id = p_event_id;
  SELECT COUNT(*) INTO v_with_email
  FROM contacts WHERE event_id = p_event_id AND email IS NOT NULL AND email != '';

  IF p_user_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_unlocked
    FROM customer_contact_access WHERE user_id = p_user_id AND event_id = p_event_id;

    SELECT COALESCE(balance, 0) INTO v_balance
    FROM customer_credits WHERE user_id = p_user_id;

    SELECT EXISTS(
      SELECT 1 FROM customer_event_subscriptions
      WHERE user_id = p_user_id AND event_id = p_event_id
    ) INTO v_is_subscribed;
  END IF;

  RETURN json_build_object(
    'total_contacts', v_total,
    'unlocked_count', v_unlocked,
    'remaining_count', v_total - v_unlocked,
    'contacts_with_email', v_with_email,
    'user_balance', v_balance,
    'is_subscribed', v_is_subscribed
  );
END;
$$;


-- ─────────────────────────────────────────────
-- RPC: api_get_user_credits
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api_get_user_credits(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_balance INTEGER;
BEGIN
  SELECT balance INTO v_balance FROM customer_credits WHERE user_id = p_user_id;
  RETURN COALESCE(v_balance, 0);
END;
$$;


-- ─────────────────────────────────────────────
-- RPC: api_get_unlocked_contacts
-- Paginated list of contacts user has already unlocked.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION api_get_unlocked_contacts(
  p_user_id UUID,
  p_event_id UUID,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_total INTEGER;
  v_contacts JSON;
BEGIN
  -- Total unlocked for this event
  SELECT COUNT(*) INTO v_total
  FROM customer_contact_access cca
  WHERE cca.user_id = p_user_id AND cca.event_id = p_event_id;

  -- Fetch page
  SELECT json_agg(row_to_json(t)) INTO v_contacts
  FROM (
    SELECT
      c.id AS contact_id,
      c.full_name,
      c.first_name,
      c.last_name,
      c.current_title,
      c.headline,
      c.contact_linkedin_url,
      c.city,
      c.country,
      c.email,
      c.email_status,
      c.company_name,
      c.company_linkedin_url,
      c.company_domain,
      c.company_website,
      c.company_industry,
      c.company_size,
      c.post_url,
      c.post_date,
      cca.charged_at,
      cca.is_downloaded
    FROM customer_contact_access cca
    JOIN contacts c ON c.id = cca.contact_id
    WHERE cca.user_id = p_user_id AND cca.event_id = p_event_id
    ORDER BY cca.charged_at DESC
    LIMIT p_limit
    OFFSET p_offset
  ) t;

  RETURN json_build_object(
    'contacts', COALESCE(v_contacts, '[]'::json),
    'total', v_total,
    'limit', p_limit,
    'offset', p_offset,
    'has_more', (p_offset + p_limit) < v_total
  );
END;
$$;
```

---

## 4. New Files to Create

### Directory structure

```
app/src/
├── lib/
│   ├── supabase/
│   │   └── admin.ts                    ← NEW: Service role client
│   └── api/
│       ├── auth.ts                     ← NEW: API key validation + generation
│       ├── errors.ts                   ← NEW: Standard error responses
│       ├── rate-limit.ts               ← NEW: In-memory rate limiter
│       ├── usage-logger.ts             ← NEW: Log API requests
│       └── types.ts                    ← NEW: API-specific types
├── app/
│   ├── api/
│   │   ├── v1/
│   │   │   ├── credits/
│   │   │   │   └── route.ts            ← NEW: GET /api/v1/credits
│   │   │   └── events/
│   │   │       ├── route.ts            ← NEW: GET /api/v1/events
│   │   │       └── [eventId]/
│   │   │           ├── contacts/
│   │   │           │   └── route.ts    ← NEW: GET + POST contacts
│   │   │           └── status/
│   │   │               └── route.ts    ← NEW: GET event status
│   │   └── internal/
│   │       └── keys/
│   │           └── route.ts            ← NEW: Key generation (dashboard use)
│   └── dashboard/
│       └── integrations/
│           ├── page.tsx                ← MODIFY: Replace Coming Soon
│           └── components/
│               └── api-key-manager.tsx ← NEW: Key management UI
```

---

### 4.1 `app/src/lib/supabase/admin.ts`

```typescript
import { createClient } from "@supabase/supabase-js";

/**
 * Creates a Supabase client using the service role key.
 * Bypasses ALL Row Level Security — use only in server-side API routes.
 * NEVER import this in client components or expose it to the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
```

---

### 4.2 `app/src/lib/api/types.ts`

```typescript
export interface ApiKeyRecord {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface AuthenticatedRequest {
  userId: string;
  apiKeyId: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
```

---

### 4.3 `app/src/lib/api/errors.ts`

```typescript
import { NextResponse } from "next/server";
import type { ApiErrorBody } from "./types";

export function apiError(
  status: number,
  code: string,
  message: string
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message } },
    { status }
  );
}

export function unauthorized(message = "Invalid or missing API key") {
  return apiError(401, "UNAUTHORIZED", message);
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

export function serverError(message = "Internal server error") {
  return apiError(500, "INTERNAL_ERROR", message);
}
```

---

### 4.4 `app/src/lib/api/auth.ts`

```typescript
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthenticatedRequest } from "./types";

/**
 * Hash an API key using SHA-256 (Web Crypto API — works in Next.js Edge and Node).
 */
async function hashApiKey(rawKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate a Bearer token from the Authorization header.
 * Returns the user_id and api_key_id if valid, or null.
 */
export async function authenticateApiKey(
  authHeader: string | null
): Promise<AuthenticatedRequest | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const rawKey = authHeader.slice(7);
  if (!rawKey || rawKey.length < 20) {
    return null;
  }

  const keyHash = await hashApiKey(rawKey);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("api_keys")
    .select("id, user_id, is_active")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    return null;
  }

  // Update last_used_at (fire and forget — don't block response)
  admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then();

  return {
    userId: data.user_id,
    apiKeyId: data.id,
  };
}

/**
 * Generate a new API key. Returns:
 * - rawKey: show to user ONCE, never stored
 * - keyHash: stored in database
 * - keyPrefix: stored for display (e.g., "wg_a1b2c3d4")
 */
export async function generateApiKey(): Promise<{
  rawKey: string;
  keyHash: string;
  keyPrefix: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const rawKey = `wg_${hex}`;           // "wg_" prefix makes keys identifiable
  const keyHash = await hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 11); // "wg_" + first 8 hex chars

  return { rawKey, keyHash, keyPrefix };
}
```

---

### 4.5 `app/src/lib/api/rate-limit.ts`

```typescript
/**
 * In-memory sliding-window rate limiter.
 * 60 requests per minute per API key.
 *
 * For MVP this is fine. For production with multiple server instances,
 * upgrade to Upstash Redis or Vercel KV.
 */

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 60;

const requestLog = new Map<string, number[]>();

export function checkRateLimit(apiKeyId: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  // Filter to current window
  const timestamps = (requestLog.get(apiKeyId) ?? []).filter(
    (t) => t > windowStart
  );

  if (timestamps.length >= MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: timestamps[0] + WINDOW_MS,
    };
  }

  timestamps.push(now);
  requestLog.set(apiKeyId, timestamps);

  return {
    allowed: true,
    remaining: MAX_REQUESTS - timestamps.length,
    resetAt: now + WINDOW_MS,
  };
}

// Garbage collection — prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, timestamps] of requestLog.entries()) {
    const filtered = timestamps.filter((t) => t > cutoff);
    if (filtered.length === 0) {
      requestLog.delete(key);
    } else {
      requestLog.set(key, filtered);
    }
  }
}, 5 * 60 * 1000); // every 5 minutes
```

---

### 4.6 `app/src/lib/api/usage-logger.ts`

```typescript
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthenticatedRequest } from "./types";
import type { NextRequest } from "next/server";

/**
 * Log an API request for auditing. Fire-and-forget — never blocks the response.
 */
export async function logApiUsage(
  auth: AuthenticatedRequest,
  endpoint: string,
  statusCode: number,
  creditsUsed: number,
  request: NextRequest
) {
  try {
    const admin = createAdminClient();
    await admin.from("api_usage_log").insert({
      api_key_id: auth.apiKeyId,
      user_id: auth.userId,
      endpoint,
      method: request.method,
      status_code: statusCode,
      credits_used: creditsUsed,
      request_ip:
        request.headers.get("x-forwarded-for") ??
        request.headers.get("x-real-ip") ??
        "unknown",
    });
  } catch {
    // Logging failures must not break API responses
    console.error("Failed to log API usage");
  }
}
```

---

### 4.7 `app/src/app/api/v1/credits/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { unauthorized, rateLimited, serverError } from "@/lib/api/errors";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiUsage } from "@/lib/api/usage-logger";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request.headers.get("Authorization"));
  if (!auth) return unauthorized();

  const rateCheck = checkRateLimit(auth.apiKeyId);
  if (!rateCheck.allowed) return rateLimited();

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_get_user_credits", {
    p_user_id: auth.userId,
  });

  if (error) {
    await logApiUsage(auth, "GET /api/v1/credits", 500, 0, request);
    return serverError();
  }

  await logApiUsage(auth, "GET /api/v1/credits", 200, 0, request);

  return NextResponse.json(
    { data: { balance: data } },
    { headers: { "X-RateLimit-Remaining": String(rateCheck.remaining) } }
  );
}
```

---

### 4.8 `app/src/app/api/v1/events/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { unauthorized, rateLimited, serverError } from "@/lib/api/errors";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiUsage } from "@/lib/api/usage-logger";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request.headers.get("Authorization"));
  if (!auth) return unauthorized();

  const rateCheck = checkRateLimit(auth.apiKeyId);
  if (!rateCheck.allowed) return rateLimited();

  const admin = createAdminClient();

  // get_all_browsable_events is an existing RPC — it doesn't use auth.uid()
  // for the event list itself, so it works with the service role client.
  const { data, error } = await admin.rpc("get_all_browsable_events");

  if (error) {
    await logApiUsage(auth, "GET /api/v1/events", 500, 0, request);
    return serverError();
  }

  await logApiUsage(auth, "GET /api/v1/events", 200, 0, request);

  return NextResponse.json(
    { data: { events: data ?? [] } },
    { headers: { "X-RateLimit-Remaining": String(rateCheck.remaining) } }
  );
}
```

---

### 4.9 `app/src/app/api/v1/events/[eventId]/contacts/route.ts`

This is the **core endpoint** — GET retrieves unlocked contacts, POST unlocks new ones.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import {
  unauthorized,
  rateLimited,
  badRequest,
  serverError,
} from "@/lib/api/errors";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiUsage } from "@/lib/api/usage-logger";

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

/**
 * GET /api/v1/events/:eventId/contacts?limit=50&offset=0
 * Returns paginated list of contacts the user has already unlocked.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateApiKey(request.headers.get("Authorization"));
  if (!auth) return unauthorized();

  const rateCheck = checkRateLimit(auth.apiKeyId);
  if (!rateCheck.allowed) return rateLimited();

  const { eventId } = await params;
  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50"), 1),
    100
  );
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0"), 0);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_get_unlocked_contacts", {
    p_user_id: auth.userId,
    p_event_id: eventId,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    await logApiUsage(
      auth,
      `GET /api/v1/events/${eventId}/contacts`,
      500,
      0,
      request
    );
    return serverError();
  }

  await logApiUsage(
    auth,
    `GET /api/v1/events/${eventId}/contacts`,
    200,
    0,
    request
  );

  return NextResponse.json(
    { data },
    { headers: { "X-RateLimit-Remaining": String(rateCheck.remaining) } }
  );
}

/**
 * POST /api/v1/events/:eventId/contacts
 * Body: { "count": 10 }
 * Unlocks new contacts and deducts credits.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateApiKey(request.headers.get("Authorization"));
  if (!auth) return unauthorized();

  const rateCheck = checkRateLimit(auth.apiKeyId);
  if (!rateCheck.allowed) return rateLimited();

  const { eventId } = await params;

  // Parse body
  let body: { count?: number };
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const count = body.count;
  if (!count || typeof count !== "number" || count < 1 || count > 500) {
    return badRequest("count must be a number between 1 and 500");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_unlock_event_contacts", {
    p_user_id: auth.userId,
    p_event_id: eventId,
    p_count: count,
  });

  if (error) {
    await logApiUsage(
      auth,
      `POST /api/v1/events/${eventId}/contacts`,
      500,
      0,
      request
    );
    return serverError();
  }

  const result = data as {
    success: boolean;
    message: string;
    credits_spent?: number;
    new_balance?: number;
    contacts_unlocked?: number;
  };

  const statusCode = result.success ? 200 : 400;
  await logApiUsage(
    auth,
    `POST /api/v1/events/${eventId}/contacts`,
    statusCode,
    result.credits_spent ?? 0,
    request
  );

  return NextResponse.json(
    { data: result },
    {
      status: statusCode,
      headers: { "X-RateLimit-Remaining": String(rateCheck.remaining) },
    }
  );
}
```

---

### 4.10 `app/src/app/api/v1/events/[eventId]/status/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api/auth";
import { unauthorized, rateLimited, serverError } from "@/lib/api/errors";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiUsage } from "@/lib/api/usage-logger";

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await authenticateApiKey(request.headers.get("Authorization"));
  if (!auth) return unauthorized();

  const rateCheck = checkRateLimit(auth.apiKeyId);
  if (!rateCheck.allowed) return rateLimited();

  const { eventId } = await params;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("api_get_event_unlock_status", {
    p_user_id: auth.userId,
    p_event_id: eventId,
  });

  if (error) {
    await logApiUsage(
      auth,
      `GET /api/v1/events/${eventId}/status`,
      500,
      0,
      request
    );
    return serverError();
  }

  await logApiUsage(
    auth,
    `GET /api/v1/events/${eventId}/status`,
    200,
    0,
    request
  );

  return NextResponse.json(
    { data },
    { headers: { "X-RateLimit-Remaining": String(rateCheck.remaining) } }
  );
}
```

---

### 4.11 `app/src/app/api/internal/keys/route.ts`

Internal route called by the dashboard (with cookies) to generate API keys. NOT a public API endpoint.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/api/auth";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const name = body.name || "Default";

  // Limit: max 5 active keys per user
  const { count } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_active", true);

  if ((count ?? 0) >= 5) {
    return NextResponse.json(
      { error: "Maximum 5 active API keys allowed" },
      { status: 400 }
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
    })
    .select(
      "id, name, key_prefix, is_active, created_at, last_used_at, revoked_at"
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // rawKey is shown to the user ONCE — it is never stored anywhere
  return NextResponse.json({ rawKey, key: inserted });
}
```

---

### 4.12 `app/src/app/dashboard/integrations/components/api-key-manager.tsx`

Client component for managing API keys in the dashboard.

```typescript
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface Props {
  initialKeys: ApiKey[];
}

export default function ApiKeyManager({ initialKeys }: Props) {
  const [keys, setKeys] = useState<ApiKey[]>(initialKeys);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [copied, setCopied] = useState(false);
  const supabase = createClient();

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/internal/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName || "Default" }),
      });
      const result = await res.json();

      if (result.error) {
        alert(result.error);
        return;
      }

      if (result.rawKey) {
        setNewRawKey(result.rawKey);
        setKeys((prev) => [result.key, ...prev]);
        setKeyName("");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(keyId: string) {
    if (!confirm("Revoke this API key? Any integrations using it will stop working.")) {
      return;
    }

    const { error } = await supabase
      .from("api_keys")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("id", keyId);

    if (!error) {
      setKeys((prev) =>
        prev.map((k) =>
          k.id === keyId ? { ...k, is_active: false, revoked_at: new Date().toISOString() } : k
        )
      );
    }
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-8 space-y-6">
      {/* Show raw key banner (only after creation) */}
      {newRawKey && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Copy your API key now — it won't be shown again!
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded bg-white px-3 py-2 text-xs font-mono text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 break-all">
              {newRawKey}
            </code>
            <button
              onClick={() => copyToClipboard(newRawKey)}
              className="shrink-0 rounded-md bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setNewRawKey(null)}
            className="mt-2 text-xs text-amber-600 hover:underline"
          >
            I've saved it, dismiss
          </button>
        </div>
      )}

      {/* Create new key */}
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Create API Key
        </h3>
        <p className="mt-1 text-xs text-zinc-400">
          Generate a key to access the WhoGoes API. Max 5 active keys.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Key name (e.g., Production)"
            className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? "Generating..." : "Generate Key"}
          </button>
        </div>
      </div>

      {/* Keys list */}
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Your API Keys
          </h3>
        </div>
        {keys.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-zinc-400">
            No API keys yet. Create one above.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
            {keys.map((key) => (
              <li key={key.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {key.name}
                  </p>
                  <p className="text-xs text-zinc-400 font-mono">
                    {key.key_prefix}...
                  </p>
                  <p className="text-xs text-zinc-400">
                    Created {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used_at &&
                      ` · Last used ${new Date(key.last_used_at).toLocaleDateString()}`}
                  </p>
                </div>
                <div>
                  {key.is_active ? (
                    <button
                      onClick={() => handleRevoke(key.id)}
                      className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      Revoke
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-400">Revoked</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

---

## 5. Changes to Existing Files

### 5.1 `app/src/middleware.ts`

Add early return for API routes (they use Bearer tokens, not cookies):

```typescript
import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // API routes use Bearer token auth, not cookies — skip session handling
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

### 5.2 `app/src/app/dashboard/integrations/page.tsx`

Replace the "Coming Soon" stub:

```typescript
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import ApiKeyManager from "./components/api-key-manager";

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: apiKeys } = await supabase
    .from("api_keys")
    .select(
      "id, name, key_prefix, is_active, created_at, last_used_at, revoked_at"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
        API & Integrations
      </h1>
      <p className="mt-1 text-sm text-zinc-400">
        Manage API keys to access WhoGoes data programmatically.
      </p>

      <ApiKeyManager initialKeys={apiKeys ?? []} />

      {/* Quick reference */}
      <div className="mt-10 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Quick Start
        </h3>
        <pre className="mt-3 overflow-x-auto rounded bg-zinc-50 p-3 text-xs dark:bg-zinc-800">
{`# Check your credits
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  https://yourapp.com/api/v1/credits

# List events
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  https://yourapp.com/api/v1/events

# Unlock 10 contacts from an event
curl -X POST \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"count": 10}' \\
  https://yourapp.com/api/v1/events/EVENT_ID/contacts

# Get your unlocked contacts
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "https://yourapp.com/api/v1/events/EVENT_ID/contacts?limit=50&offset=0"`}
        </pre>
      </div>
    </div>
  );
}
```

### 5.3 `app/src/types/index.ts`

Add at the end of the file:

```typescript
// API key display in dashboard
export interface ApiKeyDisplay {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}
```

---

## 6. API Endpoint Reference

| Method | Path | Description | Costs Credits? |
|--------|------|-------------|----------------|
| `GET` | `/api/v1/credits` | Check credit balance | No |
| `GET` | `/api/v1/events` | List all available events | No |
| `GET` | `/api/v1/events/:id/status` | Unlock progress for an event | No |
| `GET` | `/api/v1/events/:id/contacts` | Get unlocked contacts (paginated) | No |
| `POST` | `/api/v1/events/:id/contacts` | Unlock new contacts | **Yes** |

### Authentication

All endpoints require a Bearer token:
```
Authorization: Bearer wg_your_api_key_here
```

### Pagination (GET contacts)

| Param | Default | Max | Description |
|-------|---------|-----|-------------|
| `limit` | 50 | 100 | Contacts per page |
| `offset` | 0 | — | Skip this many contacts |

### Rate Limiting

- 60 requests per minute per API key
- `X-RateLimit-Remaining` header on every response
- HTTP 429 when exceeded

### Error Format

All errors return:
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing API key"
  }
}
```

### Success Format

All success responses return:
```json
{
  "data": { ... }
}
```

---

## 7. Scenarios & Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Insufficient credits** | If user requests 500 contacts but has 200 credits, the RPC unlocks 200 (the minimum of requested, available, balance). Response includes `credits_spent: 200`. This is **partial fulfillment**, not rejection. |
| **Duplicate unlock request** | If user calls POST twice for the same event, the second call only unlocks contacts NOT yet unlocked. Already-unlocked contacts are skipped (via `NOT EXISTS` check). No double-charging. |
| **All contacts already unlocked** | Returns `success: false, message: "No more contacts to unlock"` with 0 credits charged. |
| **Invalid event ID** | Returns 0 contacts available. No credits charged. |
| **Revoked API key** | Returns 401 Unauthorized. The `is_active = true` check filters it out. |
| **Expired/missing Bearer token** | Returns 401 Unauthorized. |
| **Rate limit exceeded** | Returns 429 with `RATE_LIMITED` error code. |
| **Invalid JSON body** | Returns 400 with `BAD_REQUEST` error. |
| **count = 0 or negative** | Returns 400 "Invalid count" from the RPC. |
| **count > 500** | Returns 400 from request validation (before hitting the DB). |
| **Concurrent requests** | The `customer_contact_access` UNIQUE constraint prevents double-inserts at the DB level. |
| **API key leaked** | User revokes from dashboard. `is_active = false` immediately blocks all requests. |
| **Server restart** | Rate limit counters reset (in-memory). Acceptable for MVP. |

---

## 8. Security Considerations

1. **Hashed keys**: Only SHA-256 hashes stored. Raw key shown once on creation.
2. **Key prefix**: `wg_a1b2c3d4` lets users identify keys without exposing them.
3. **No full key in logs**: `api_usage_log` references `api_key_id`, never the raw key.
4. **Service role key**: Never exposed to browser (no `NEXT_PUBLIC_` prefix).
5. **Max 5 keys per user**: Prevents key proliferation abuse.
6. **IP logging**: `x-forwarded-for` captured for audit.
7. **Rate limiting**: 60 req/min per key prevents abuse.
8. **Internal vs public routes**: `/api/internal/*` uses cookie auth (dashboard), `/api/v1/*` uses Bearer auth (public API).

---

## 9. Step-by-Step Implementation Order

Order matters — later steps depend on earlier ones.

### Phase 1: Foundation

| Step | What | Why first |
|------|------|-----------|
| 1 | Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` | Everything else needs this |
| 2 | Run `03-api-keys.sql` in Supabase SQL Editor | Creates tables + RPCs |
| 3 | Create `src/lib/supabase/admin.ts` | All API routes depend on admin client |

### Phase 2: API Infrastructure

| Step | What |
|------|------|
| 4 | Create `src/lib/api/types.ts` |
| 5 | Create `src/lib/api/errors.ts` |
| 6 | Create `src/lib/api/auth.ts` |
| 7 | Create `src/lib/api/rate-limit.ts` |
| 8 | Create `src/lib/api/usage-logger.ts` |

### Phase 3: Middleware

| Step | What |
|------|------|
| 9 | Modify `src/middleware.ts` — add `/api/` early return |

### Phase 4: API Routes

| Step | What | Test with |
|------|------|-----------|
| 10 | `GET /api/v1/credits` | Simplest endpoint, validates full auth flow |
| 11 | `GET /api/v1/events` | List events |
| 12 | `GET /api/v1/events/:id/status` | Event unlock status |
| 13 | `GET + POST /api/v1/events/:id/contacts` | Core unlock + fetch endpoint |

### Phase 5: Dashboard

| Step | What |
|------|------|
| 14 | Create `src/app/api/internal/keys/route.ts` |
| 15 | Create `src/app/dashboard/integrations/components/api-key-manager.tsx` |
| 16 | Replace `src/app/dashboard/integrations/page.tsx` |
| 17 | Add `ApiKeyDisplay` to `src/types/index.ts` |

### Phase 6: Test

| Step | What |
|------|------|
| 18 | Generate API key via dashboard |
| 19 | Test all endpoints with curl (see section 10) |
| 20 | Verify rate limiting works (fire 61 rapid requests) |
| 21 | Verify key revocation blocks access |
| 22 | Verify credits deduct correctly |

---

## 10. Testing with curl

```bash
# Replace with your actual values
API_KEY="wg_your_key_here"
BASE_URL="http://localhost:3000"
EVENT_ID="your-event-uuid"

# 1. Check credits
curl -s -H "Authorization: Bearer $API_KEY" \
  $BASE_URL/api/v1/credits | jq

# 2. List events
curl -s -H "Authorization: Bearer $API_KEY" \
  $BASE_URL/api/v1/events | jq

# 3. Check event status before unlocking
curl -s -H "Authorization: Bearer $API_KEY" \
  $BASE_URL/api/v1/events/$EVENT_ID/status | jq

# 4. Unlock 5 contacts
curl -s -X POST \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"count": 5}' \
  $BASE_URL/api/v1/events/$EVENT_ID/contacts | jq

# 5. Get unlocked contacts (page 1)
curl -s -H "Authorization: Bearer $API_KEY" \
  "$BASE_URL/api/v1/events/$EVENT_ID/contacts?limit=50&offset=0" | jq

# 6. Verify credits were deducted
curl -s -H "Authorization: Bearer $API_KEY" \
  $BASE_URL/api/v1/credits | jq

# 7. Test invalid key (should return 401)
curl -s -H "Authorization: Bearer wg_invalid_key" \
  $BASE_URL/api/v1/credits | jq

# 8. Test rate limiting (fire many requests quickly)
for i in $(seq 1 65); do
  curl -s -o /dev/null -w "%{http_code} " \
    -H "Authorization: Bearer $API_KEY" \
    $BASE_URL/api/v1/credits
done
echo  # Should see 200s then 429s
```

---

## 11. Future Improvements

These are NOT needed for MVP but worth planning for:

| Improvement | When to add |
|-------------|-------------|
| **Redis rate limiting** | When deploying to multiple server instances (Vercel scales horizontally) |
| **Webhook notifications** | When users want push delivery instead of polling |
| **API key scopes/permissions** | When you want read-only vs read-write keys |
| **Usage dashboard** | Show API usage charts from `api_usage_log` data |
| **Billing integration** | Connect Stripe to auto-purchase credits when balance is low |
| **OpenAPI/Swagger spec** | Auto-generate API documentation |
| **SDK** | Publish a JavaScript/Python SDK for easier integration |
| **Batch unlock endpoint** | Unlock contacts across multiple events in one call |
| **API key expiration** | Auto-expire keys after N days for security |
