# WhoGoes Public API — Build Log

Single-source-of-truth summary of what was built across the V1 + V2 API rollout (April 2026). Pairs with [API.md](./API.md) (user-facing reference) and [API_TEST_PLAN.md](./API_TEST_PLAN.md) (test cases). Use this doc to onboard yourself or anyone else to the API surface in one read.

---

## Decisions locked in with the user

| Decision | Choice |
|---|---|
| Rollout order | V1 first (transactional), V2 next (subscribe-and-poll feed) |
| Free user UX | Block at `/dashboard/integrations` with upgrade CTA. `is_api_eligible` re-checked on every request. |
| Spend cap | Per-key `daily_credit_cap` only (no monthly). NULL = unlimited. UTC reset. |
| Event identifier | Routes accept slug OR UUID. Resolver in [event-resolver.ts](../src/lib/api/event-resolver.ts). |
| Idempotency | `Idempotency-Key` header on POST /events/:id/contacts and POST /contacts/pull. Cached in `api_usage_log` row. |
| Rate limit | 60 req/min per key, in-memory sliding window. Acceptable for MVP. |
| Auto-unlock UI placement | Compact one-line chip next to event metadata on both `/dashboard/my-events?event=...` AND `/dashboard/events/[id]`. |

---

## Architecture map

```
Browser ─cookie auth─→ /api/internal/keys           (key generation, edit)
                       /api/internal/subscriptions  (auto-unlock toggle from dashboard)

External script ─Bearer→ /api/v1/credits            (no charge)
                         /api/v1/events             (no charge)
                         /api/v1/events/:id/status  (no charge)
                         /api/v1/events/:id/contacts (GET no charge, POST charges)
                         /api/v1/contacts           (no charge — all-events fetch, paginated, since-filterable)
                         /api/v1/contacts/new       (no charge — dry-run preview)
                         /api/v1/contacts/pull      (charges, walks subscriptions)
                         /api/v1/subscriptions      (no charge — CRUD)

All /api/v1/* routes:
  → middleware skips Supabase cookie session
  → gateRequest() runs: bearer auth → is_api_eligible → rate limit
  → service-role Supabase client calls api_* RPCs (RLS bypassed by design)
  → fire-and-forget logApiUsage()
```

---

## Files (new + modified)

### SQL — applied to linked Supabase project `citrznhubxqvsfhjkssg` (Outbound)

| File | Purpose |
|---|---|
| [sql/10-api-keys.sql](../sql/10-api-keys.sql) | `api_keys`, `api_usage_log` tables; RLS; `is_api_eligible`, `api_daily_credit_spend`, `api_get_user_credits`, `api_get_event_unlock_status`, `api_unlock_event_contacts`, `api_get_unlocked_contacts` RPCs |
| [sql/11-usage-history-by-date.sql](../sql/11-usage-history-by-date.sql) | Rewrites `get_usage_history` to GROUP BY (UTC date, event_id) — fixes the billing-page MIN(charged_at) bug |
| [sql/12-api-list-events.sql](../sql/12-api-list-events.sql) | Fast `api_list_events()` RPC; replaces the heavy `get_all_browsable_events` for the API endpoint to avoid statement_timeout. Adds `idx_contact_events_event_id`. |
| [sql/13-api-subscriptions.sql](../sql/13-api-subscriptions.sql) | Adds `auto_unlock_enabled`, `max_unlocks_per_event`, `last_api_pulled_at` to `customer_event_subscriptions`; INSERT/UPDATE/DELETE RLS policies; `api_list_subscriptions`, `api_upsert_subscription`, `api_pull_new_contacts` RPCs |
| [sql/14-api-all-contacts.sql](../sql/14-api-all-contacts.sql) | `api_get_all_unlocked_contacts` RPC for cross-event paginated fetch with `since` filter |

### Server-side library

| File | Purpose |
|---|---|
| [src/lib/api/types.ts](../src/lib/api/types.ts) | `ApiKeyRecord`, `AuthenticatedRequest`, `ApiErrorBody` |
| [src/lib/api/errors.ts](../src/lib/api/errors.ts) | Standard error responses: `unauthorized`, `paymentRequired`, `forbidden`, `notFound`, `badRequest`, `rateLimited`, `spendCapExceeded`, `serverError` |
| [src/lib/api/auth.ts](../src/lib/api/auth.ts) | `authenticateApiKey` (bearer + paid-tier check), `generateApiKey`, `hashApiKey` |
| [src/lib/api/rate-limit.ts](../src/lib/api/rate-limit.ts) | In-memory sliding-window limiter, 60 req/min |
| [src/lib/api/usage-logger.ts](../src/lib/api/usage-logger.ts) | `logApiUsage` (fire-and-forget), `findIdempotentResponse` |
| [src/lib/api/spend-cap.ts](../src/lib/api/spend-cap.ts) | `getSpendCapState` — calls `api_daily_credit_spend` RPC, returns remaining + retry-after |
| [src/lib/api/event-resolver.ts](../src/lib/api/event-resolver.ts) | `resolveEventId(idOrSlug)` |
| [src/lib/api/handler.ts](../src/lib/api/handler.ts) | `gateRequest` — runs all common gates (bearer/paid/rate) and returns auth or NextResponse |

### Routes

| Path | Methods | Notes |
|---|---|---|
| `/api/v1/credits` | GET | Total balance (free + paid) |
| `/api/v1/events` | GET | Lean list using `api_list_events` (no contacts_with_email, no is_subscribed) |
| `/api/v1/events/[idOrSlug]/status` | GET | Per-event detail with email count, settled-row filter |
| `/api/v1/events/[idOrSlug]/contacts` | GET, POST | GET = paginated unlocked. POST = unlock new (charges). Idempotency-Key supported. Daily cap enforced. |
| `/api/v1/contacts` | GET | All-events fetch, `?limit=&offset=&since=`, max 200 per page |
| `/api/v1/contacts/new` | GET | Dry-run preview of next pull |
| `/api/v1/contacts/pull` | POST | Walks auto-unlock subscriptions, charges credits |
| `/api/v1/subscriptions` | GET, POST, PATCH, DELETE | Full CRUD via Bearer auth |
| `/api/internal/keys` | POST, PATCH | Cookie-auth, paid-tier gated. Generates `wg_*` keys. Max 5 active per user. |
| `/api/internal/subscriptions` | PATCH | Cookie-auth. Used by the dashboard auto-unlock toggle. |

### UI

| File | Purpose |
|---|---|
| [src/app/dashboard/integrations/page.tsx](../src/app/dashboard/integrations/page.tsx) | Paid users see the key manager + curl quick-start + "API Documentation" button. Free users see upgrade CTA + docs link. |
| [src/app/dashboard/integrations/components/api-key-manager.tsx](../src/app/dashboard/integrations/components/api-key-manager.tsx) | Generate / list / revoke keys. Daily cap input. |
| [src/app/dashboard/events/[id]/api-auto-unlock.tsx](../src/app/dashboard/events/[id]/api-auto-unlock.tsx) | Compact one-line chip. Free / paid-no-key / paid-with-key states. Inline cap input when toggle on. |
| [src/app/dashboard/events/[id]/event-detail.tsx](../src/app/dashboard/events/[id]/event-detail.tsx) | Renders the chip below event metadata. |
| [src/app/dashboard/my-events/page.tsx](../src/app/dashboard/my-events/page.tsx) | Pre-fetches eligibility + key count + sub map; passes to view. |
| [src/app/dashboard/my-events/my-events-view.tsx](../src/app/dashboard/my-events/my-events-view.tsx) | Renders the chip alongside the selected-event header (the page where users actually live). |
| [src/app/docs/api/page.tsx](../src/app/docs/api/page.tsx) | Public docs page at `/docs/api`. SSR markdown render of `app/docs/API.md` via `next-mdx-remote`. 1-hour ISR. |
| [src/app/dashboard/billing/billing-content.tsx](../src/app/dashboard/billing/billing-content.tsx) | Updated to render new per-(date, event) usage rows. Custom `formatUsageDate` to avoid TZ shift. |

### Middleware

- [src/middleware.ts](../src/middleware.ts) — `/api/v1/*` early-return (no Supabase cookie work).
- [src/lib/supabase/middleware.ts](../src/lib/supabase/middleware.ts) — `/docs/*` whitelisted as public.

### Tests + tooling

- [scripts/test-api.sh](../scripts/test-api.sh) — 44 curl assertions covering V1 + V2. Env: `WG_KEY`, `WG_BASE`, `WG_EVENT`. Exits non-zero on any failure.
- [docs/API.md](./API.md) — user-facing reference. Includes endpoints-at-a-glance table, V1 + V2 sections, error codes, recipes (idempotent retry, daily incremental sync).
- [docs/API_TEST_PLAN.md](./API_TEST_PLAN.md) — 90+ test cases tagged P0/P1/P2 across 12 surface areas.

---

## Things future-you should know (gotchas)

1. **`get_all_browsable_events` is a footgun for any new API endpoint.** It can cross statement_timeout on cold cache. The API uses `api_list_events` instead. Don't reach for the dashboard RPC for new public endpoints.

2. **Service-role bypasses RLS.** All `/api/v1/*` routes use `createAdminClient()` and rely on the RPC's `WHERE user_id = p_user_id` clause for tenant isolation. If you add a new `api_*` RPC, the WHERE clause is the security boundary — get it right.

3. **Idempotency replay path returns BEFORE logApiUsage.** That's intentional: we don't want replays to inflate `api_usage_log`. Don't "fix" this by moving the log call.

4. **Free credits consumed before paid.** Mirrors the existing `unlock_event_contacts`. If a paid user has free trial credits left, the paid balance won't budge until those are exhausted. Test setups inserting `customers` rows should account for this when verifying.

5. **`ad7fca60-5768-4ed9-abe7-0dd14150be53` (`hello@whogoes.co`)** has a synthetic `customers` row added during E2E setup (+100 credits, +$5). Reverse with `DELETE FROM customers WHERE user_id = 'ad7fca60-5768-4ed9-abe7-0dd14150be53';` — and remember they have ~2009 free credits, so they'll keep showing as paid via free credits even after the customers row is removed (the `is_api_eligible` check is what actually gates them, and that depends on `total_purchased_credits > 0`).

6. **Settled-row filter (3-hour gate)** lives in: `unlock_event_contacts`, `api_unlock_event_contacts`, `api_pull_new_contacts`, `api_get_event_unlock_status`. NOT in the list endpoint (`api_list_events`) — that uses raw counts because list views are informational, not transactional.

7. **The auto-unlock chip sits in TWO places:** `/dashboard/events/[id]` (public/landing) and `/dashboard/my-events?event=...` (authenticated daily flow). The component file lives under `events/[id]/` but is imported by both. Keep changes consistent.

8. **`POST /contacts/pull` doesn't return contact rows.** Just counts + breakdown. To get the actual data, follow up with `GET /contacts?since=<5min_ago>`. This separation is deliberate — see [API.md](./API.md) recipes section.

9. **Dev server cold compile vs Postgres timeout.** The first Next.js call to any API route compiles on demand and can take 2-5s. This is NOT the same as the Postgres statement_timeout. Don't conflate them when triaging slow first calls.

---

## Status as of 2026-04-25

- V1: complete, 24/24 smoke pass.
- V2: complete, 44/44 smoke pass total.
- Docs: live at `/docs/api`.
- Billing usage tab fix: live (per-day rollup).
- Cold-start hardening for `/api/v1/events`: live (replaced heavy RPC).

## Possible next steps (NOT done)

- Webhooks (push delivery for new contacts) — defer until ≥5 paying API users.
- Read-only vs read-write key scopes — the daily cap covers most of the same risk.
- OpenAPI/Swagger spec generated from routes.
- Vercel cron warmer (only matters once on the production deployment).
- Email alert when balance < 50 with active auto-unlock subscriptions.
