# Internal Email Automation

Self-hosted transactional + lifecycle email for WhoGoes. Replaced Loops.so on 2026-06-06. Plain-text only, sent from `hello@contact.whogoes.co` (reply-to `hello@whogoes.co`), driven off live Supabase state. **Status: LIVE.**

## Architecture

- **Provider:** Resend (free tier). Domain `contact.whogoes.co` verified (DKIM + SPF + MX on the `send.` subdomain). API key in Vercel `RESEND_API_KEY`.
- **Queue + log:** Supabase table `email_messages` doubles as the scheduled queue (a `pending` row with a future `scheduled_for` is a wait timer) and the sent log. Idempotency via unique `dedupe_key`.
- **Suppression:** `email_suppressions` (reasons: `stop_reply` | `admin` | `bounce`).
- **Engine:** `src/lib/email/` — `client.ts` (Resend send, plain text + `List-Unsubscribe` header), `templates.ts` (all copy + branching), `enqueue.ts`, `signup.ts` (`onUserSignup`), `process.ts` (scan + send passes).
- **Processor route:** `GET/POST /api/email/process?secret=EMAIL_CRON_SECRET` (Vercel env). Runs scans then sends due rows.
- **Scheduler:** n8n on the elestio instance — **WhoGoes Email — Queue Processor** (`WHfCLY9jbU76AoAD`, every 5 min → process route) and **WhoGoes Email — STOP Unsubscribe** (`Wn87cUhtl4pLUhEF`, Gmail trigger on `hello@whogoes.co` → matches "stop"/"unsubscribe" → `/api/email/unsubscribe`). Both Active.
- **Sender:** From "Souraa from WhoGoes" `<hello@contact.whogoes.co>`, signed "Souraa". Every email ends with a reply-"STOP" PS. The first (welcome) email has no links.

## Triggers → emails

| Trigger | Code | Emails |
|---|---|---|
| New signup (OAuth) | `auth/callback/route.ts` → `onUserSignup` | `welcome` (T+0), `inactive_day1` (+24h), `inactive_day3` (+72h); + `prospect_bonus` if email matches a scraped contact |
| New signup (email/pw) | register pages → `/api/email/signup` → `onUserSignup` | same |
| First unlock (any path) | processor scan (`email_scan_active_flow`) | `active_1h` (first unlock +1h), `active_day2` (+48h) |
| Event 5 days out, free user | processor scan (`email_scan_pre_event`) | `pre_event_5d` |
| Balance ≤5, active user | processor scan (`email_scan_low_balance`) | `low_balance` |
| First payment | `payments/verify/route.ts` | `paid_immediate`, `paid_day2` (+48h), `paid_day4` (+96h) |
| Admin adds credits | `admin/api/add-credits/route.ts` | `credits_added` |

**Inactive vs active are mutually exclusive** (inactive steps skip at send if the user has unlocked). **`active_day2`** branches: single event (adds the ">15 days out → post closer to the event" guidance when far out) vs multiple events (lists each, suggests the soonest).

### prospect_bonus: grant-at-send (2026-06-07)
The +100 complimentary credits are granted by the **queue processor right before** the `prospect_bonus` email is sent (`process.ts`), via `admin_add_credits`. The email only sends if the grant succeeds; a `creditsGranted` payload flag makes retries idempotent. `signup.ts` only enqueues the row — it does **not** grant. This guarantees the email never announces credits that weren't added.

## Go-live cutoff (fresh start)
`email_go_live()` returns `2026-06-06 17:45:00+00`. The three scan RPCs only consider accounts created **after** the cutoff. The ~214 accounts that existed at launch never receive scan/nurture flows, even if they unlock later — they only ever get purchase-triggered emails (`paid_*`, `credits_added`). To change it, edit `email_go_live()` via a new migration. (At launch, existing unlockers/low-bal/pre-event candidates were also backfilled as `skipped` rows tagged `payload.backfill=true`.)

## Send-pass rules (`process.ts`)
Order per due row: suppression check → daily cap → (prospect_bonus credit grant) → load live context → condition skip → render → send.
- **Transactional set** (`welcome`, `prospect_bonus`, `credits_added`, `paid_immediate`) bypasses suppression and the daily cap.
- **Daily cap:** net 1 non-transactional email per user per day; extras deferred +1 day.
- Dynamic content (balance, unlocked/remaining, events) is computed at **send time** via `get_user_email_context(user_id)`.

## Migrations / RPCs
- `20260606120000_internal_email_automation.sql` — tables + `get_user_email_context`, `find_prospect_event_for_email`, `email_scan_active_flow`, `email_scan_pre_event`, `email_scan_low_balance` (all SECURITY DEFINER, service_role only).
- `20260606174500_email_go_live_cutoff.sql` — `email_go_live()` + cutoff added to the scans.

## Environment
- Vercel: `RESEND_API_KEY`, `EMAIL_CRON_SECRET` (must match the value in both n8n workflows).
- Local `app/.env.local`: same two, plus `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_URL` (used by tests + the audit skill).

## Testing & auditing
- **Ongoing audit:** run the `/audit-emails` skill (`~/.claude/skills/audit-emails/`). Read-only; checks failures, cron health, prospect-bonus grant integrity, cutoff breaches, missing welcome, duplicate sends, and prints per-recipient timelines. Verify each new signup's timeline against the trigger table above.
- **Full test suites** (used during build; route sends to Resend's `delivered@resend.dev` sink, clean up after):
  - Template rendering: `npx tsx /tmp/test_templates.mts` style — content rules, branching, no em dashes, PS, no links in welcome.
  - Processor mechanics + scans: create a throwaway auth user (Auth admin API), exercise cap/suppression/condition/dedupe/scan, then delete the user (FK cascade cleans up).
- **Manual:** sign up a fresh address → welcome arrives within ~5 min (n8n cron). Reply "STOP" → suppressed within a minute.

## Troubleshooting
- **Emails not sending / many overdue pending:** n8n Queue Processor paused, or `EMAIL_CRON_SECRET` mismatch (route returns 401). Check n8n + Vercel.
- **`failed` rows:** read `last_error` (usually Resend domain/rate issue). Resend dashboard → Emails for delivery detail.
- **Lands in Promotions:** reputation warm-up; improves with engagement. Welcome is link-free to help Primary placement.
- **Pause everything fast:** deactivate the n8n workflows, or remove `EMAIL_CRON_SECRET` from Vercel.
