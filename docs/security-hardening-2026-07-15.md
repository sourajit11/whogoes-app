# Security Hardening — 2026-07-15

Second full Security Advisor sweep (first was 2026-04-11, see `security-advisor-fixes.md`).
Advisor findings went from **267 (11 at ERROR level) to 46**, all remaining ones intentional or informational.

## Vulnerabilities fixed

### 1. complete_payment free-credits exploit (CRITICAL)
The old `complete_payment(order_id, payment_id, signature)` stored the Razorpay
signature without verifying it and was executable by any authenticated user via
PostgREST. A logged-in user could create an order (`/api/payments/create-order`),
then call the RPC directly with a fake signature and receive the credits without paying.

Fix (migrations `20260715065407` + `20260715070240`):
- 4-arg `complete_payment(p_user_id, ...)` — service-role only, called by
  `/api/payments/verify` after session + HMAC checks (route updated, in working tree).
- 3-arg `complete_payment(...)` — kept for the currently deployed frontend, but it
  now verifies the HMAC-SHA256 signature **inside Postgres** (pgcrypto) against the
  Razorpay key secret stored in `private.app_secrets` (schema not exposed to the API,
  no anon/authenticated grants). Forged signatures are rejected even on direct calls.
  HMAC parity with Node's `crypto.createHmac` was verified against live data.

### 2. api_upsert_subscription cross-user write
Trusted its `p_user_id` parameter and was executable by authenticated users, so any
user could create/modify another user's event subscription. Now raises unless
`p_user_id = auth.uid()` (service_role, where `auth.uid()` is NULL, is exempt).
`/api/internal/subscriptions` also switched to the admin client (working tree).

### 3. 109 SECURITY DEFINER functions executable by anon + authenticated
Every `admin_*`, `api_*`, pipeline, enrichment, spd_* and trigger function was callable
by any visitor with the public anon key (e.g. `admin_add_credits`, `merge_duplicate_contacts`,
`upsert_contact`). All SECURITY DEFINER functions in `public` are now service-role-only,
with an explicit grant-back list:
- **anon + authenticated**: `get_event_by_slug` (public event pages + OG images).
- **authenticated only** (all scoped by `auth.uid()` internally): affiliate_* (4),
  get_customer_credits, get_dashboard_overview, get_subscribed_events,
  get_subscribed_event_contacts, get_payment_history, get_usage_history,
  is_api_eligible, get_event_preview, get_event_unlock_status, get_event_filter_facets,
  get_event_filter_preview, reveal_event_emails, set_contact_note,
  set_contacts_processed, subscribe_to_event, unlock_event_contacts,
  complete_payment (3-arg, HMAC-verified), api_upsert_subscription (uid-guarded).

### 4. Advisor lints cleared
- `rls_disabled_in_public`: RLS enabled on `company_industry_bucket_map`.
- `security_definer_view` (10 pipeline views v_*): SELECT revoked from anon/authenticated.
- `materialized_view_in_api`: `admin_data_quality` revoked from anon/authenticated.
- `function_search_path_mutable` (13): pinned `search_path = public`.

### 5. Regression prevention
`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON
FUNCTIONS FROM PUBLIC` — new functions are no longer callable by anon/authenticated
by default. **Any future user-facing RPC must include an explicit
`GRANT EXECUTE ... TO authenticated` (and `anon` if public) in its migration.**
This is why the April fix regressed: 100+ functions created since then inherited
the permissive Postgres default.

## Remaining advisor findings (all accepted)
- 22× INFO `rls_enabled_no_policy` — internal pipeline tables, deny-by-default is the intent.
- 21× WARN `authenticated_security_definer_function_executable` + 1× anon — the
  intentional RPC surface listed above.
- 1× WARN `auth_leaked_password_protection` — **manual step, see below**.

## Manual steps for Souraa
1. Dashboard → Authentication → Sign In / Providers → Passwords: enable
   **Leaked password protection** (the CLI token lacks auth-config write scope).
2. Same screen: raise minimum password length from 6 to 8.

## Open items
- ~15 local migration files exist that were applied via SQL editor but never recorded
  in `supabase_migrations.schema_migrations` (e.g. 20260705*, 20260707*, 20260712 13/131/132/15/17-series).
  52 remote-only orphans were backfilled as local files today; the reverse direction
  still needs a careful reconciliation session before `db push` is trustworthy again.
- The two route edits (`api/payments/verify`, `api/internal/subscriptions`) are in the
  working tree, uncommitted —