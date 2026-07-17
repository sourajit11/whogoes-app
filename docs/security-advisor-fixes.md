# Supabase Security Advisor Fixes

**Applied:** 2026-04-11 (04:30 UTC)
**Supabase project:** `citrznhubxqvsfhjkssg` ("Outbound")
**Applied by:** Claude via `supabase db query --linked` + Management API

This doc records the security hardening done against the Supabase Security Advisor. If anything in the app or pipeline starts failing with `permission denied`, `row-level security`, or `function search_path` errors in the future, start here.

---

## TL;DR

- **Before:** 11 errors + ~52 warnings in Supabase Security Advisor
- **After:** 0 errors, 0 warnings
- **Rollback available:** [supabase/migrations/20260413_security_advisor_fixes_ROLLBACK.sql](../supabase/migrations/20260413_security_advisor_fixes_ROLLBACK.sql)
- **Main migration:** [supabase/migrations/20260413_security_advisor_fixes.sql](../supabase/migrations/20260413_security_advisor_fixes.sql)
- **Run command:** `cd app && npx supabase db query --linked --file=supabase/migrations/20260413_security_advisor_fixes.sql`

---

## What was changed

Four independent fixes, all wrapped in one atomic `BEGIN/COMMIT` transaction. If any statement had failed, the whole migration would have rolled back.

### 1. Leaked password protection (Supabase Auth)
**Problem:** HaveIBeenPwned check was disabled. Users could sign up with known-breached passwords.
**Fix:** `PATCH /v1/projects/citrznhubxqvsfhjkssg/config/auth` with `{"password_hibp_enabled": true}` via Management API.
**Impact on workflows:** None. Only affects new signups with compromised passwords.

### 2. Revoked view access from anon/authenticated (10 views)
**Problem:** 4 admin views + 6 orphaned views were granted to `anon`/`authenticated` and flagged as SECURITY DEFINER views (auth data exposure).
**Fix:** `REVOKE SELECT ON [view] FROM anon, authenticated;`
**Views affected:**
- Admin: `admin_customer_overview`, `admin_revenue_summary`, `admin_event_popularity`, `admin_data_quality`
- Pipeline/internal: `v_contacts_for_reprofile`, `v_mentions_pending`, `v_posts_with_events`, `v_contacts_for_enrichment`, `v_companies_for_enrichment`, `v_event_contacts`

**Why it's safe:** Admin pages use `createAdminClient()` which hits the views via `service_role`. `service_role` bypasses GRANTs entirely. The 6 non-admin views had no code references.

**If this breaks something:** If a future feature tries to read one of these views from the browser or a logged-in session, it will fail with `permission denied for view [name]`. Fix by using `createAdminClient()` on the server instead.

### 3. Dropped overly permissive RLS write policies (27 policies across 9 tables)
**Problem:** Policies named "Service role can insert/update/delete..." were actually attached to the `authenticated` role with `USING(true)`. Meaning: any logged-in user could INSERT/UPDATE/DELETE rows in these 9 tables.
**Fix:** `DROP POLICY "Service role can [insert|update|delete] ..." ON [table];`
**Tables affected:** `companies`, `contact_emails`, `contact_events`, `contacts`, `email_threads`, `events`, `outreach_campaigns`, `post_mentions`, `posts`

**Why it's safe:** All writes to these tables happen via:
- **SECURITY DEFINER RPCs** (bypass RLS — `unlock_event_contacts`, `upsert_contact`, `upsert_company`, `link_contact_to_event`, `enrich_company`, etc.)
- **`service_role` client** in admin and pipeline code (bypasses RLS entirely)
- **n8n workflows** using the `service_role` key (bypasses RLS)

**SELECT policies were intentionally kept** — authenticated users still need read access to browse events and contacts.

**If this breaks something:** Only relevant if a workflow writes to these tables as `authenticated` or `anon` (not `service_role`). Symptoms: `new row violates row-level security policy for table [name]` or `permission denied for table [name]`. Fix by switching the caller to `service_role` or wrapping the write in a SECURITY DEFINER RPC.

**Which tables are NOT in this list (still have write protection from other policies):** `customer_credits`, `customer_event_subscriptions`, `customer_contact_access`, `user_signups`, `customers`, `payments`. These have proper `auth.uid() = user_id` policies.

### 4. Pinned `search_path = 'public'` on 28 functions
**Problem:** Functions had mutable `search_path`, which allows search path injection attacks.
**Fix:** `ALTER FUNCTION [name]([args]) SET search_path = 'public';`
**Why `'public'` not `''`:** All functions use unqualified table names like `FROM contacts`, not `FROM public.contacts`. Setting `search_path = ''` would break every function.

**Functions affected (28 total):**
- User RPCs: `get_customer_credits`, `unlock_event_contacts`, `get_event_unlock_status`, `get_subscribed_events`, `get_event_preview`, `get_event_by_slug`, `get_all_browsable_events`, `get_subscribed_event_contacts`, `mark_contacts_downloaded`, `complete_payment`, `get_payment_history`, `get_usage_history`, `get_dashboard_overview`, `get_my_events`, `subscribe_to_event`, `get_event_contacts`
- Admin RPCs: `admin_get_business_stats`, `admin_adjust_credits`, `admin_add_credits`, `admin_get_dashboard_data`
- Pipeline/internal: `upsert_contact`, `upsert_company`, `link_contact_to_event`, `enrich_company`, `merge_duplicate_contacts`, `delete_orphaned_posts`, `process_daily_credit_deductions`, `normalize_linkedin_company_url`

**Why it's safe:** Pure security hardening. No logic change. All queries in these functions still resolve against the `public` schema exactly as before.

**If this breaks something:** Symptom would be `relation "[table_name]" does not exist` from a function call. Means the function references a table in a schema other than `public`. Fix by fully qualifying the reference (`FROM other_schema.table`).

### 5. RLS initplan optimization (7 policies)
**Problem:** Policies evaluated `auth.uid()` once per row instead of once per query (performance warning).
**Fix:** `ALTER POLICY "[name]" ON [table] USING ((select auth.uid()) = user_id);`
**Policies affected:**
- `Users can read own credits` on `customer_credits`
- `Users can read own subscriptions` on `customer_event_subscriptions`
- `Users can read own access` on `customer_contact_access`
- `Users can update own access` on `customer_contact_access`
- `Users can read own signup` on `user_signups`
- `Users can read own customer record` on `customers`
- `Users read own payments` on `payments`

**Why it's safe:** Pure performance fix. Zero behavior change — same logical result, faster execution.

---

## Post-migration verification (what we tested)

All passed immediately after the migration ran:

| Test | Expected | Actual |
|---|---|---|
| `supabase db advisors --linked` | `No issues found` | ✅ No issues found |
| `SELECT COUNT(*) FROM admin_customer_overview` | >0 | 53 |
| `SELECT COUNT(*) FROM admin_revenue_summary` | >0 | 2 |
| `SELECT COUNT(*) FROM admin_event_popularity` | >0 | 339 |
| `SELECT COUNT(*) FROM admin_data_quality` | >0 | 327 |
| `SELECT COUNT(*) FROM get_all_browsable_events()` | >0 | 339 |
| Count of functions with `search_path=public` set | 28 | 28 |
| Remaining policies on `contacts`/`companies`/`events`/`posts` | 1 SELECT each | ✅ SELECT only |
| Service_role INSERT/UPDATE/DELETE on `companies` (rolled back) | Succeeds | ✅ All three succeeded |

---

## How to re-verify if something seems off

Run these in order. Each one takes a few seconds.

```bash
cd /Users/sourajitshantikari/Research/Whogoes/app

# 1. Re-run the advisor — should still say "No issues found"
npx supabase db advisors --linked

# 2. Verify all four admin views still respond
npx supabase db query --linked "SELECT 'admin_revenue_summary' AS v, COUNT(*) FROM admin_revenue_summary UNION ALL SELECT 'admin_event_popularity', COUNT(*) FROM admin_event_popularity UNION ALL SELECT 'admin_data_quality', COUNT(*) FROM admin_data_quality UNION ALL SELECT 'admin_customer_overview', COUNT(*) FROM admin_customer_overview;"

# 3. Verify the core browsing RPC still works
npx supabase db query --linked "SELECT COUNT(*) FROM get_all_browsable_events();"

# 4. Verify service_role can still write (rolled back, no data changes)
npx supabase db query --linked "BEGIN; INSERT INTO companies (name, domain, linkedin_url) VALUES ('test', 'test.local', 'https://linkedin.com/company/test') RETURNING id; ROLLBACK;"

# 5. Verify all 28 functions still have search_path pinned
npx supabase db query --linked "SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND 'search_path=public' = ANY(p.proconfig);"
```

---

## How to roll back (only if something breaks)

```bash
cd /Users/sourajitshantikari/Research/Whogoes/app
npx supabase db query --linked --file=supabase/migrations/20260413_security_advisor_fixes_ROLLBACK.sql
```

This restores: all 10 view GRANTs, all 27 "Service role" write policies, function `search_path` to mutable, and the 7 initplan policies back to `auth.uid() = user_id`.

**Note:** Rolling back the leaked-password-protection setting requires a separate Management API call (set `password_hibp_enabled: false`). The rollback SQL file does NOT cover that.

---

## Troubleshooting guide — "if X breaks, check Y"

| Symptom | Likely cause | Fix |
|---|---|---|
| Admin dashboard page shows empty data or 500 error | View GRANT issue (Part 2) — code may have stopped using `createAdminClient()` | Ensure the route uses `createAdminClient()` from [src/lib/supabase/admin.ts](../src/lib/supabase/admin.ts), not the browser client |
| n8n workflow fails with `new row violates row-level security policy` | n8n is using the `anon` key, not `service_role` (Part 3) | Open n8n → Credentials → Supabase → verify the key is `service_role` (decode at jwt.io to confirm) |
| Pipeline script fails with `permission denied for table contacts` | Same as above — caller using wrong key | Check `SUPABASE_SERVICE_ROLE_KEY` is set in the env |
| RPC call fails with `relation "xxx" does not exist` | Function references a non-`public` table (Part 4) | Qualify the reference as `schema.table` inside the function body |
| User login starts rejecting common passwords | Expected — HIBP check is now on (Part 1) | This is working as intended. To disable: Management API `PATCH` with `password_hibp_enabled: false` |
| A logged-in user can no longer write to `contacts`/`posts`/etc. | Expected — write policies were removed (Part 3) | They shouldn't have been able to anyway. Use an RPC or `service_role` |

---

## 2026-07-15 — Second hardening pass + two real vulns fixed

The advisor had drifted back up to **267 findings**. This pass took it to **~47, with 0 ERRORs** — everything left is intentional (see "Accepted findings" below) or the one HIBP toggle.

**Migrations (both applied via MCP `execute_sql`, version rows inserted manually):**
- `supabase/migrations/20260715065407_security_advisor_hardening_july.sql`
- `supabase/migrations/20260715070240_payment_hmac_and_subscription_guard.sql`

### Two REAL vulnerabilities found and fixed
1. **CRITICAL — free-credit mint.** The old `complete_payment(text,text,text)` never verified the Razorpay signature and was callable by any logged-in user via PostgREST. Fix: the 3-arg version (which deployed code calls) now verifies the **HMAC-SHA256 signature inside Postgres** (pgcrypto) against `private.app_secrets` key `razorpay_key_secret`, then delegates using `auth.uid()`. A 4-arg `complete_payment(p_user_id uuid, ...)` is service-role-only. **The hole is closed at the DB layer regardless of which app code is deployed.**
2. **MEDIUM — cross-user subscription write.** `api_upsert_subscription(p_user_id, ...)` trusted `p_user_id`. Now guards `p_user_id = auth.uid()` unless called by service_role.

### What the hardening migration did
- Enabled RLS on `company_industry_bucket_map` (deny-by-default, no policies).
- Revoked anon/authenticated SELECT on 10 SECURITY DEFINER pipeline views + `admin_data_quality` matview → service_role only.
- Revoked EXECUTE on ALL ~120 SECURITY DEFINER functions from PUBLIC/anon/authenticated, then granted back only the intentional surface: `get_event_by_slug` (anon+authenticated) + 21 dashboard/affiliate RPCs (authenticated, all `auth.uid()`-scoped). Everything `admin_*`, `api_*`, pipeline, `spd_*`, trigger = service-role only.
- Pinned `search_path=public` on 13 flagged functions.
- `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`.

### ⚠️ NEW STANDING RULE (this is the big one)
Because default privileges no longer auto-grant EXECUTE, **every new user-facing RPC migration MUST include an explicit `GRANT EXECUTE ... TO authenticated`** (and `anon` if the endpoint is public), or the endpoint will return **401** in production. If a dashboard RPC suddenly 401s after a deploy, this is why — the migration forgot its GRANT.

### `private.app_secrets`
New table holding the Razorpay signing secret (`razorpay_key_secret`), read only by SECURITY DEFINER functions. The row is inserted **operationally, not in the migration file** (so the secret never lands in the repo). If HMAC verification starts rejecting all legit payments, confirm this row exists and matches the live Razorpay key secret.

### HIBP regressed
Leaked-password protection was enabled 2026-04-11 (Part 1 above) but the advisor shows it **disabled again** as of 2026-07-15 — auth config was reset at some point (likely a compute-tier change / restore). Re-enable it in **Dashboard → Authentication** (the CLI token 403s on the Management API auth-config PATCH). Password min-length can stay at 6 (marginal at current user volume); HIBP is the part that matters.

### Accepted findings (intentional — do NOT "fix")
- **22× `rls_enabled_no_policy` (INFO):** deny-by-default on internal pipeline tables. Correct.
- **24× authenticated SECURITY DEFINER RPCs (WARN):** the dashboard/affiliate/event surface, all `auth.uid()`-scoped.
- **1× `get_event_by_slug` anon-executable (WARN):** powers public event pages. Intentional.
- **1× `auth_leaked_password_protection` (WARN):** the HIBP toggle above.

### Code edits pending deploy (NOT urgent — DB already protects deployed code)
- `src/app/api/payments/verify/route.ts` → 4-arg `complete_payment` via admin client
- `src/app/api/internal/subscriptions/route.ts` → `api_upsert_subscription` via admin client after session check

### Migration tracker reconciliation (2026-07-15)
Recorded 12 applied-but-untracked migrations (10 from 2026-07-05/07 + `sdr_intro_campaign` + `companies_add_source`), renamed `20260705130000_moltsets_company_enrichment` → `20260705130001` (timestamp collided with `whogoes_prospects`), and deleted 5 redundant duplicate files (`20260712{130000,131000,132000,150000,170000}`, byte-identical to already-recorded earlier-timestamp copies). **Still unreconciled:** ~12 older migrations recorded under "scrambled" version numbers (local filename version ≠ recorded version, e.g. `20260628121000` recorded as `20260628090105`) and the `20260702` sdr_bdr set (2 identical dups, 2 with *diverged* SQL). Those need a decision before `supabase db push` is safe — do NOT blind-push.

---

## Related files

- **Main migration:** [supabase/migrations/20260413_security_advisor_fixes.sql](../supabase/migrations/20260413_security_advisor_fixes.sql)
- **Rollback:** [supabase/migrations/20260413_security_advisor_fixes_ROLLBACK.sql](../supabase/migrations/20260413_security_advisor_fixes_ROLLBACK.sql)
- **Admin client (uses service_role):** [src/lib/supabase/admin.ts](../src/lib/supabase/admin.ts)
- **Pipeline writer:** [pipeline/daily-extract.mjs](../pipeline/daily-extract.mjs)
- **Original RPC definitions:** [sql/02-unlock-rpcs.sql](../sql/02-unlock-rpcs.sql), [sql/03-admin-views-rpcs.sql](../sql/03-admin-views-rpcs.sql), [sql/07-admin-dashboard-rpc.sql](../sql/07-admin-dashboard-rpc.sql)
