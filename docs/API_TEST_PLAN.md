# WhoGoes Public API — V1 Test Plan

Comprehensive test cases for the V1 transactional API. Cases are grouped by surface area. Severity tags:

- **P0** must-pass before any release. Auth, paid gating, credit deduction, idempotency.
- **P1** important behavior; ship with known regressions only after triage.
- **P2** edge cases and polish.

Each test specifies: setup, action, expected outcome. Where applicable, the automated curl in [scripts/test-api.sh](../scripts/test-api.sh) covers the case.

---

## 1. Authentication & paid-tier gating

### 1.1 [P0] Missing Authorization header → 401
- **Action:** `curl /api/v1/credits` with no header.
- **Expect:** 401, `error.code = "UNAUTHORIZED"`, message mentions "Bearer".

### 1.2 [P0] Wrong scheme → 401
- **Action:** `curl -H "Authorization: Basic foo" /api/v1/credits`
- **Expect:** 401.

### 1.3 [P0] Garbage Bearer token → 401
- **Action:** `Authorization: Bearer wg_definitely_not_real_xxxxx`.
- **Expect:** 401, message "Invalid or revoked API key."

### 1.4 [P0] Valid hash but `is_active = false` → 401
- **Setup:** Take a real key, revoke it via dashboard.
- **Action:** Use the (now revoked) raw key.
- **Expect:** 401.

### 1.5 [P0] Free user generates key via UI → blocked
- **Setup:** User with `customers.total_purchased_credits = 0` (or no `customers` row).
- **Action:** Visit `/dashboard/integrations`.
- **Expect:** Upgrade CTA shown; no key form. Direct `POST /api/internal/keys` returns 403 `"API access requires a paid plan."`.

### 1.6 [P0] Paid user becomes free mid-session → keys stop working
- **Setup:** Paid user with active key. Manually set `customers.total_purchased_credits = 0`.
- **Action:** Use existing key against `/credits`.
- **Expect:** 402 `PAYMENT_REQUIRED`. (Defense-in-depth check on every request.)

### 1.7 [P1] Bearer with leading/trailing whitespace → tolerated
- **Action:** `Authorization: Bearer   wg_xxx   ` (extra spaces).
- **Expect:** 200 (whitespace trimmed in `auth.ts`).

### 1.8 [P2] Key shorter than 20 chars → 401
- **Action:** `Authorization: Bearer abc`.
- **Expect:** 401, no DB lookup performed.

---

## 2. Rate limiting

### 2.1 [P0] 60 requests within 60s → all allowed
- **Action:** Loop 60 GETs to `/credits`.
- **Expect:** All 200. Final `X-RateLimit-Remaining: 0`.

### 2.2 [P0] 61st request within window → 429
- **Action:** Continue from 2.1 to a 61st request.
- **Expect:** 429, `error.code = "RATE_LIMITED"`.

### 2.3 [P1] After window resets → allowed again
- **Action:** Wait 60s after 2.2, retry.
- **Expect:** 200.

### 2.4 [P1] Per-key isolation
- **Setup:** Two keys for the same user.
- **Action:** Burn the first key's quota; immediately call with the second.
- **Expect:** Second key unaffected.

---

## 3. Credits endpoint (`GET /credits`)

### 3.1 [P0] Returns total balance (free + paid)
- **Setup:** User with `user_signups.free_credits = 5`, `customers.credits_balance = 100`.
- **Action:** `GET /credits`.
- **Expect:** `data.balance = 105`.

### 3.2 [P1] Newly created customer with no `user_signups` row → returns paid only
- **Setup:** User has `customers.credits_balance = 50` but `user_signups` row was never created.
- **Action:** `GET /credits`.
- **Expect:** `data.balance = 50`. Note: `api_get_user_credits` does NOT lazy-create `user_signups` (unlike the dashboard RPC). API users are paid users; they don't need a free trial.

---

## 4. Events list (`GET /events`)

### 4.1 [P0] Returns array of events
- **Action:** `GET /events`.
- **Expect:** 200, `data.events` is an array; each row has `event_id`, `event_slug`, `total_contacts`, `is_active`.

### 4.2 [P1] Slugs are populated
- **Expect:** No `event_slug = null` in the response (the `events.slug` column is NOT NULL post-migration 04).

### 4.3 [P2] `is_subscribed` is `false` for all
- **Why:** This route uses the cached admin RPC (no auth.uid() context). It's correct that it doesn't reflect per-user state — clients should derive subscription state from `/events/:id/status`.

---

## 5. Event status (`GET /events/:idOrSlug/status`)

### 5.1 [P0] By UUID
- **Action:** `GET /events/<uuid>/status`.
- **Expect:** 200, response has `total_contacts`, `unlocked_count`, `remaining_count`, `contacts_with_email`, `user_balance`, `is_subscribed`.

### 5.2 [P0] By slug
- **Action:** `GET /events/modex-2026/status`.
- **Expect:** Same response shape; data identical to 5.1 for the same event.

### 5.3 [P0] Unknown slug → 404
- **Action:** `GET /events/this-event-does-not-exist/status`.
- **Expect:** 404, `error.code = "NOT_FOUND"`.

### 5.4 [P0] `total_contacts` excludes contacts < 3 hours old
- **Setup:** Insert a `contacts` row with `created_at = now()` and link via `contact_events`.
- **Action:** Call status.
- **Expect:** Total does NOT include the new contact (settled-row filter active).

### 5.5 [P1] `unlocked_count` and `is_subscribed` reflect this user only
- **Setup:** Two paid users; user A unlocks 5; user B unlocks 0.
- **Expect:** A's status shows `unlocked_count: 5, is_subscribed: true`; B shows `0, false`.

---

## 6. Unlock contacts (`POST /events/:idOrSlug/contacts`)

### 6.1 [P0] Happy path: count=5, balance=100, available=20 → unlocks 5, charges 5
- **Expect:** 200, `data.success = true`, `credits_spent = 5`, `new_balance = 95`, `contacts_unlocked = 5`. One row per contact in `customer_contact_access`.

### 6.2 [P0] Auto-subscribes on first unlock
- **Action:** First-ever unlock for an event.
- **Expect:** Row appears in `customer_event_subscriptions` with `is_paused = false`.

### 6.3 [P0] Partial fulfillment when balance < count
- **Setup:** Balance = 3, request count = 10.
- **Expect:** 200, `credits_spent = 3`, `new_balance = 0`, `contacts_unlocked = 3`. NOT a 400.

### 6.4 [P0] Partial fulfillment when available < count
- **Setup:** Event has 7 unlocked-able contacts, request 10.
- **Expect:** `credits_spent = 7`, `contacts_unlocked = 7`.

### 6.5 [P0] All available already unlocked → success: false, 0 charge
- **Setup:** User has unlocked every contact for the event.
- **Action:** POST with count=10.
- **Expect:** 200 (NOT 400), `data.success = false`, message "No more contacts to unlock", `credits_spent = 0`. `customer_credits` unchanged.

### 6.6 [P0] Zero balance → success: false, 0 charge
- **Setup:** `user_signups.free_credits = 0` AND `customers.credits_balance = 0`.
- **Expect:** `data.success = false`, message "No credits remaining", `current_balance = 0`.

### 6.7 [P0] Free credits consumed before paid credits
- **Setup:** `free_credits = 3`, `paid = 10`. Unlock 5.
- **Expect:** Post-call: `free_credits = 0`, `paid = 8`.

### 6.8 [P0] Idempotency-Key — same key, same body → cached response, single charge
- **Action:** POST with `Idempotency-Key: K`, `count=5`. Then POST again with same K.
- **Expect:** Both responses identical. Second response has header `Idempotency-Replayed: true`. Only ONE charge in `customer_contact_access` and ONE deduction.

### 6.9 [P0] No idempotency key, identical body, two requests → DOUBLE charge
- **Setup:** Available = 100.
- **Action:** Two consecutive POSTs of `{count: 5}` without `Idempotency-Key`.
- **Expect:** Each is a fresh transaction; total `credits_spent = 10`. (This is the contract; the user opted out of idempotency.)

### 6.10 [P0] Daily spend cap enforced
- **Setup:** Key with `daily_credit_cap = 10`, balance = 100, available = 1000.
- **Action:** POST `{count: 50}`.
- **Expect:** First call: 200, `credits_spent = 10`, `contacts_unlocked = 10` (capped). Second call same day: 402 `SPEND_CAP_EXCEEDED` with `Retry-After` header pointing at next UTC midnight.

### 6.11 [P1] Daily cap = 0 on key
- **Setup:** Key with `daily_credit_cap = 0`.
- **Action:** Any POST.
- **Expect:** 402 immediately on first call.

### 6.12 [P0] Settled-row filter — contacts < 3 hours old NOT eligible to unlock
- **Setup:** Insert a fresh `contacts` row, link via `contact_events`. Try to unlock from an event that ONLY has fresh rows.
- **Expect:** "No more contacts to unlock", 0 charge.

### 6.13 [P1] Email-verified contacts unlocked first
- **Setup:** Event has 10 contacts, 3 with valid email, 7 without.
- **Action:** Unlock 3.
- **Expect:** All 3 unlocked rows correspond to the email-verified contacts.

### 6.14 [P0] count = 0 → 400
- **Action:** POST `{count: 0}`.
- **Expect:** 400 `BAD_REQUEST`, "count must be an integer between 1 and 500".

### 6.15 [P0] count = 501 → 400
### 6.16 [P0] count = -1 → 400
### 6.17 [P0] count = 3.5 → 400
### 6.18 [P0] count = "10" (string) → 400

### 6.19 [P0] Malformed JSON → 400
- **Action:** POST with body `{count:`.
- **Expect:** 400 "Invalid JSON body".

### 6.20 [P0] Unknown event slug → 404
### 6.21 [P0] Unknown event UUID → 404

### 6.22 [P1] CONFLICT race: two POSTs for same contacts in parallel
- **Setup:** Two requests with the same key, no idempotency, fire concurrently.
- **Expect:** No DB constraint violation. The unique constraint on `(user_id, contact_id, event_id)` keeps inserts idempotent. Both responses sum to the actual contacts inserted (the `ROW_COUNT` accounting in the RPC ensures we don't overcharge).

### 6.23 [P2] Idempotency-Key reused across keys
- **Setup:** Two keys for the same user, same Idempotency-Key, same body.
- **Expect:** Both treated as separate operations (the unique constraint is on `(api_key_id, idempotency_key)`). Each charges separately. This is acceptable — keys are how we scope idempotency.

---

## 7. Get unlocked contacts (`GET /events/:idOrSlug/contacts`)

### 7.1 [P0] Returns previously unlocked contacts
- **Setup:** User has unlocked 5.
- **Action:** GET.
- **Expect:** `data.contacts` length 5; each row has `email`, `company_name`, `post_url`, etc.

### 7.2 [P0] Pagination respects limit and offset
- **Setup:** 50 unlocked.
- **Action:** GET `?limit=20&offset=20`.
- **Expect:** 20 rows, `total: 50`, `offset: 20`, `has_more: true`.

### 7.3 [P1] limit clamped to [1, 100]
- **Action:** GET `?limit=500`. Expect: limit = 100. GET `?limit=0`. Expect: limit = 1.

### 7.4 [P1] offset < 0 clamped to 0
### 7.5 [P1] Non-numeric limit/offset → defaults

### 7.6 [P0] No charge regardless of how many times called
- **Action:** GET 10 times.
- **Expect:** Balance unchanged.

### 7.7 [P0] Empty result for never-unlocked event
- **Expect:** `data.contacts: []`, `total: 0`, `has_more: false`.

### 7.8 [P0] Unknown event → 404

### 7.9 [P1] Other users' unlocks not exposed
- **Setup:** User A unlocks 5; user B never has.
- **Action:** B's key calls GET on the same event.
- **Expect:** Empty array. Service-role bypasses RLS, so we rely on `WHERE user_id = p_user_id` in the RPC. Critical to verify.

---

## 8. Internal key management (`/api/internal/keys`)

### 8.1 [P0] Unauthenticated → 401
### 8.2 [P0] Authenticated free user → 403 with upgrade message
### 8.3 [P0] Authenticated paid user → key created, raw key returned ONCE
### 8.4 [P0] 6th key creation → 400 "Maximum 5 active API keys allowed"

### 8.5 [P1] PATCH updates daily_credit_cap
- **Action:** `PATCH` body `{ id, daily_credit_cap: 25 }`.
- **Expect:** 200, returned key has `daily_credit_cap: 25`.

### 8.6 [P1] PATCH `daily_credit_cap = null` → unlimited
### 8.7 [P1] PATCH another user's key → 0 rows affected (RLS denies)
- Returned `data` will be null/error from `.single()`. No update happens.

### 8.8 [P0] Raw key never appears in DB
- **Action:** Generate key. Then SQL: `SELECT key_hash FROM api_keys` — must NOT contain the raw key.

### 8.9 [P0] Raw key is shown exactly once
- **Action:** Refresh `/dashboard/integrations` after generating.
- **Expect:** Raw key not visible. Only prefix displayed.

### 8.10 [P0] Revoke (UPDATE is_active=false) immediately blocks
- **Action:** Use key, then revoke, then use again.
- **Expect:** First call 200, second call 401.

---

## 9. Middleware

### 9.1 [P0] `/api/v1/*` does not run Supabase cookie middleware
- **Action:** Hit any `/api/v1/*` endpoint.
- **Expect:** No `set-cookie: sb-...` headers in response. Confirms the early return is in place.

### 9.2 [P1] `/api/internal/*` still runs cookie middleware
- **Action:** Hit `/api/internal/keys` without cookies.
- **Expect:** Still requires login (401), middleware allowed the cookie session check to run.

### 9.3 [P1] Non-API routes still run middleware
- **Action:** Visit `/dashboard/billing`.
- **Expect:** Cookie session checked normally.

---

## 10. Dashboard UI

### 10.1 [P0] Free user view shows upgrade CTA, no key manager
### 10.2 [P0] Paid user view shows key manager + quick-start
### 10.3 [P0] Generate key flow: name + cap + click → raw key shown in amber banner
### 10.4 [P0] Copy button copies raw key to clipboard
### 10.5 [P0] After dismiss, raw key gone from DOM
### 10.6 [P0] Revoke button asks confirmation, then strikes through key
### 10.7 [P1] Daily cap displayed on the key list ("Daily cap: 25")
### 10.8 [P1] Empty cap input → cap is null (unlimited)
### 10.9 [P1] Negative cap input → client-side validation error message

---

## 11. SQL safety / RLS

### 11.1 [P0] User cannot SELECT another user's `api_keys`
- **Action:** Authenticated as user A, query `api_keys` for user B.
- **Expect:** 0 rows (RLS policy `auth.uid() = user_id`).

### 11.2 [P0] User cannot SELECT another user's `api_usage_log`
### 11.3 [P0] Service-role queries DO return cross-user rows (sanity check that bypass works as intended for the API routes)

### 11.4 [P1] DELETE cascades when auth.users row is deleted
- **Setup:** Create auth user, insert key + usage log, delete auth user.
- **Expect:** All rows in api_keys and api_usage_log for that user are gone (FK ON DELETE CASCADE).

---

## 12. Observability

### 12.1 [P0] Every API request logs to `api_usage_log`
- **Action:** Make 10 calls.
- **Expect:** 10 rows in `api_usage_log` for that key.

### 12.2 [P0] `credits_used` reflects actual deduction (not request count)
- **Setup:** Available = 3, request count = 10.
- **Expect:** `credits_used = 3` in the log row.

### 12.3 [P1] `last_used_at` on `api_keys` updates after each call
- **Action:** Make 3 calls separated by a second.
- **Expect:** `last_used_at` updates.

### 12.4 [P1] `request_ip` captured
- **Expect:** Non-null IP from `x-forwarded-for` or `x-real-ip`.

---

## How to run

- **Manual UI tests** (sections 8 & 10): Walk through `/dashboard/integrations` as both a free and paid user.
- **Curl smoke tests** (sections 1–7, 9, 12): Run [scripts/test-api.sh](../scripts/test-api.sh) — covers the P0 happy paths and major edge cases. Requires a paid user, an API key, and a known event slug.
- **DB-level verification** (sections 6.7, 6.12, 11): Use `supabase db query --linked` to inspect rows after each API call. The smoke script prints the queries you should run.
