# WhoGoes Public API

Trade show and event attendee lists, with proof, over REST. Browse events, check exactly who matches your ICP filters, unlock contacts with verified emails, and keep new matching contacts flowing in automatically. Credits are deducted from your WhoGoes account as you unlock, and you never pay twice for the same contact.

**Base URL**: `https://app.whogoes.co/api/v1`

All responses are JSON. Successful responses wrap the payload as `{ "data": ... }`. Errors return `{ "error": { "code", "message" } }`.

---

## Quick start: zero to contacts in 3 calls

You need an API key first: buy credits at [/dashboard/billing](https://app.whogoes.co/dashboard/billing), then create a key at [/dashboard/integrations](https://app.whogoes.co/dashboard/integrations). That is the only time you need the app; everything below is pure API.

```bash
export WG_KEY="wg_your_actual_key_here"

# 1. Find an event (filter by industry, region, year, date range, or name)
curl -H "Authorization: Bearer $WG_KEY" \
  "https://app.whogoes.co/api/v1/events?q=modex&year=2026"

# 2. Unlock 25 contacts matching your ICP, verified emails included
curl -X POST \
  -H "Authorization: Bearer $WG_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"count": 25, "filters": {"seniority": ["C-Suite", "VP"], "has_email": true}}' \
  https://app.whogoes.co/api/v1/events/modex-2026/unlock

# 3. Fetch the contacts you own
curl -H "Authorization: Bearer $WG_KEY" \
  "https://app.whogoes.co/api/v1/events/modex-2026/contacts?limit=100"
```

The unlock response tells you exactly what happened and what it cost:

```json
{
  "data": {
    "success": true,
    "contacts_unlocked": 25,
    "emails_revealed": 25,
    "emails_included": 0,
    "credits_spent": 50,
    "new_balance": 950,
    "batch_id": "1b0c...",
    "has_more": true
  }
}
```

---

## Authentication

Every request needs a Bearer token:

```
Authorization: Bearer wg_a1b2c3d4...
```

Keys are 67-character strings beginning with `wg_`. A key is shown once at creation and only its SHA-256 hash is stored. Lose it and you revoke and create a new one.

**Eligibility**: API access requires having purchased credits at least once. Free trial credits do not unlock the API.

**Managing keys**: create, rename, cap, and revoke keys at [/dashboard/integrations](https://app.whogoes.co/dashboard/integrations). Up to 5 active keys per account. Each key can carry an optional daily credit cap (see Rate limiting and spend caps).

---

## Pricing

Credits come from your WhoGoes balance (free trial credits are spent before paid credits). One contact identity = 1 credit. Verified emails are either included or +1 credit, depending on whether you filter:

| Unlock type | Identity | Verified email | Total per contact |
|---|---|---|---|
| No filters (or only `has_email`) | 1 credit | included | 1 credit |
| With ICP filters, `include_emails: true` (default) | 1 credit | +1 credit if the contact has one | 1 or 2 credits |
| With ICP filters, `include_emails: false` | 1 credit | not unlocked | 1 credit |
| Reveal later via `reveal-emails` | already paid | 1 credit per email revealed | +1 credit |

Rules worth knowing:

- `has_email: true` on its own is not an ICP filter. It just restricts the pool to contacts with verified emails and prices like an unfiltered unlock.
- You are only charged for emails that exist: a filtered `include_emails` unlock charges +1 only for contacts that actually have a verified email.
- You never pay twice. Unlocking again with any filters skips contacts you already own, and revealing never re-charges an unlocked email.
- Partial fulfillment, never overdraft: if your balance (or a cap) covers less than you asked for, you get what fits and are charged only for that. Check `has_more` in the response.
- Contacts are unlocked best first: verified email holders first, then most recent activity.

---

## ICP filters reference

The same filter object works everywhere: unlock bodies, facet and preview queries, contact reads, and auto-pull rules.

| Key | Type | Values |
|---|---|---|
| `seniority` | array | `C-Suite`, `Owner/Founder`, `VP`, `Director`, `Manager`, `IC`, `Other`, `Unknown` |
| `function` | array | `Sales/BD`, `Marketing`, `Operations`, `Finance`, `Engineering/Technical`, `Product`, `IT/Data`, `HR/People`, `Legal/Compliance`, `Procurement/Supply Chain`, `Customer Success`, `Creative & Content`, `Executive/General Mgmt`, `Other`, `Unknown` |
| `industry` | array | Apollo-style industry buckets, e.g. `Software & Technology`. Use the facets endpoint to see the buckets present on an event. `Unknown` matches uncategorized. |
| `size` | array | Company size buckets: `1-10`, `11-50`, `51-200`, `201-500`, `501-1000`, `1001-5000`, `5001-10000`, `10001+`, `Unknown` |
| `country` | array | Contact country names as shown in facets. `Unknown` matches missing. |
| `role` | array | `organizer`, `sponsor`, `exhibitor`, `attendee`, `expected_attendee` |
| `speaker` | boolean | `true` limits to speakers |
| `has_email` | boolean | `true` limits to contacts with a verified email |
| `title_keyword` | string | Case-insensitive match against job title or headline |
| `company_include` | string | Company name must contain this |
| `company_exclude` | string | Company name must not contain this |

An absent key means no constraint. `role: attendee` means the person posted or was tagged about attending; `expected_attendee` means weaker evidence (a bare repost).

**In GET requests** use query params. Array values are comma-separated and params are repeatable:

```
GET /v1/events/modex-2026/facets?seniority=C-Suite,VP&function=Sales/BD&has_email=true
```

If a value itself contains a comma, pass the whole object as URL-encoded JSON instead: `?filters=%7B%22seniority%22%3A%5B%22C-Suite%22%5D%7D`. The `filters` param replaces all individual params. Unknown keys return a 400 listing valid keys.

**In POST bodies** pass the object under `"filters"`.

---

## Explore before you spend

All read endpoints are free.

### `GET /v1/events`

Browse active events. Params: `year`, `region`, `country`, `industry`, `q` (name search), `starts_after`, `starts_before` (YYYY-MM-DD), `limit` (max 200), `offset`. Returns `event_id`, `event_slug`, `event_name`, location fields, `event_start_date`, `event_industry`, `total_contacts`, `contacts_with_email`, and `counts_cached_at`. List counts are refreshed on a schedule; the facets endpoint is the live truth for a specific event.

### `GET /v1/events/{idOrSlug}/status`

Live totals for one event plus your position on it: `total_contacts`, `contacts_with_email`, `unlocked_count`, `emails_unlocked`, `remaining_count`, `user_balance`, `auto_pull_enabled`. Event routes accept either the event UUID or its slug.

### `GET /v1/events/{idOrSlug}/facets`

The pre-purchase workhorse. Takes any filter params and returns live counts: `matched`, `with_email`, `owned` (matches you already unlocked, so you can compute exactly how many new contacts an unlock would deliver), and breakdowns `by_seniority`, `by_function`, `by_role`, `by_industry`, `by_size`, `by_country`, `top_companies`.

Cost estimate for a filtered unlock with emails: `(matched - owned) + with_email_among_new` credits at most; the unlock response reports the exact spend.

### `GET /v1/events/{idOrSlug}/preview`

A redacted sample of matching contacts (partial identities, no emails), same as the public event page. Params: filters plus `limit` (max 25).

---

## Unlocking and revealing

### `POST /v1/events/{idOrSlug}/unlock`

Body:

```json
{
  "count": 100,
  "filters": { "seniority": ["C-Suite", "VP"], "industry": ["Software & Technology"] },
  "include_emails": true,
  "auto_pull": false
}
```

- `count` (required): 1 to 10000. Large requests are processed in server-side chunks within one call.
- `filters` (optional): the ICP filter object. Omit for a full-list unlock (emails included at 1 credit per contact).
- `include_emails` (optional, default `true`): on filtered unlocks, bundle the email reveal (+1 credit per contact with a verified email) into this call. Set `false` to buy identities only and reveal selectively later.
- `auto_pull` (optional, default `false`): also save these filters as the event's auto-pull rule. Optional `auto_pull_max_credits_per_day` caps the rule's daily spend.

Response fields: `contacts_unlocked`, `emails_included` (free, unfiltered path), `emails_revealed` (charged, bundled path), `credits_spent`, `new_balance`, `batch_id`, `has_more`, and `auto_pull` (the saved rule, when requested). The unlock is recorded as a batch; the same filters and batch history are visible in the dashboard.

Send an `Idempotency-Key` header (any unique string, a UUID is ideal) on every unlock. Retrying with the same key returns the original response with `Idempotency-Replayed: true` and never double-charges.

### `POST /v1/events/{idOrSlug}/reveal-emails`

Reveal verified emails for contacts you own that do not have their email tier unlocked yet. 1 credit per email actually revealed. Scope it three ways:

```json
{ "contact_ids": ["uuid1", "uuid2"] }
```

or with a filter object (`{ "filters": { "seniority": ["C-Suite"] } }`), or with an empty body to reveal everything eligible on the event. Returns `emails_revealed`, `credits_spent`, `new_balance`, and `revealed`, the list of `{ contact_id, email }` pairs.

---

## Reading your contacts

### `GET /v1/events/{idOrSlug}/contacts`

Your unlocked contacts for one event. Params: any filter params, `sort` (`unlocked_at`, `full_name`, `current_title`, `company_name`, `post_date`, `email`), `dir` (`asc`/`desc`), `limit` (max 100), `offset`.

Each contact carries identity and LinkedIn URLs, company fields (name, domain, website, industry and size buckets, headquarters), `event_role`, `is_speaker`, the proof (`post_url`, `post_date`, `source`), `unlocked_at`, and `batch_id`. Email handling:

- `email`, `email_status`, `email_provider` are present only when `email_unlocked` is `true`.
- `has_email: true` with `email_unlocked: false` means a verified email exists and one reveal credit buys it.

### `GET /v1/contacts`

Same payload across all events (each row adds `event_id`, `event_slug`, `event_name`). Params: `since`, `event` (UUID or slug), `limit` (max 200), `offset`. This is the sync feed; see the recipe below.

---

## Auto-pull: scheduled fetching without a schedule

Events on WhoGoes keep growing as more people post that they are attending. Auto-pull keeps unlocking the new ones that match your ICP so your CRM stays current without you re-running unlocks.

**Turn it on** either way:

- Add `"auto_pull": true` to any unlock call. The unlock's filters and `include_emails` become the event's rule.
- Or manage rules directly:

```bash
# Create or replace a rule
curl -X PUT -H "Authorization: Bearer $WG_KEY" -H "Content-Type: application/json" \
  -d '{"filters": {"seniority": ["C-Suite"]}, "max_credits_per_day": 50}' \
  https://app.whogoes.co/api/v1/auto-pull/modex-2026

# List rules            GET    /v1/auto-pull
# Pause                 PATCH  /v1/auto-pull/modex-2026   {"paused": true}
# Remove                DELETE /v1/auto-pull/modex-2026
```

**How it runs**: the server sweeps all enabled rules about every 30 minutes. New matching contacts are unlocked and charged exactly like a manual unlock with those filters (so a filtered rule with emails costs 1 or 2 credits per contact). One rule per event; saving again replaces it.

**Cost controls**, all optional, all enforced server-side:

- `max_credits_per_day` per rule (UTC day).
- `max_total_contacts` per rule, a lifetime cap on contacts owned for that event.
- Your balance: auto-pull simply stops at zero and resumes when you top up.
- Rules run oldest-first when balance is short, so priority is predictable.

Note: per-key daily caps do not apply to the automatic sweeps (they are not tied to a key). Per-rule caps are the control for auto-pull spend.

**Pull now**: `POST /v1/pull` runs all your rules immediately. Body options: `max_credits` to cap this run, `dry_run: true` for a free estimate of what a real run would unlock and cost:

```json
{
  "data": {
    "dry_run": true,
    "estimated_credits": 42,
    "breakdown": [
      { "event_slug": "modex-2026", "available_contacts": 24, "available_with_email": 18, "estimated_credits": 42 }
    ]
  }
}
```

---

## Incremental sync recipe

Poll on your own schedule (cron, n8n, Zapier, anything) and page forward with a watermark. Idempotent by design; safe to re-run.

```bash
# First run: everything you own
curl -H "Authorization: Bearer $WG_KEY" \
  "https://app.whogoes.co/api/v1/contacts?since=1970-01-01T00:00:00Z&limit=200"

# Store the "watermark" value from the response. Next runs:
curl -H "Authorization: Bearer $WG_KEY" \
  "https://app.whogoes.co/api/v1/contacts?since=$LAST_WATERMARK&limit=200"
```

With `since`, rows come oldest first and strictly newer than the timestamp; keep requesting with `offset` (or the new watermark) until `has_more` is false, then persist the last `watermark`. Combined with auto-pull rules this is a complete pipeline: rules keep unlocking new matches, your poller keeps draining them into your system.

---

## Credits

`GET /v1/credits` returns your balance and this key's daily cap state:

```json
{ "data": { "balance": 950, "daily_cap": 200, "spent_today": 50, "remaining_today": 150 } }
```

---

## Rate limiting and spend caps

| Guardrail | Default | Configurable | Window | On exceed |
|---|---|---|---|---|
| Request rate | 60 req/min per key | No | sliding 60 s | 429 `RATE_LIMITED` |
| Credit spend | unlimited | Yes, per key | UTC day | 402 `SPEND_CAP_EXCEEDED` with `Retry-After` |

Successful responses include `X-RateLimit-Remaining`. The 402 `Retry-After` header counts the seconds to the next UTC midnight.

---

## Endpoints at a glance

| Method | Path | Costs credits? |
|---|---|---|
| GET | `/v1/credits` | No |
| GET | `/v1/events` | No |
| GET | `/v1/events/{idOrSlug}/status` | No |
| GET | `/v1/events/{idOrSlug}/facets` | No |
| GET | `/v1/events/{idOrSlug}/preview` | No |
| POST | `/v1/events/{idOrSlug}/unlock` | Yes |
| POST | `/v1/events/{idOrSlug}/reveal-emails` | Yes |
| GET | `/v1/events/{idOrSlug}/contacts` | No |
| GET | `/v1/contacts` | No |
| POST | `/v1/pull` | Yes (dry_run is free) |
| GET | `/v1/auto-pull` | No |
| PUT | `/v1/auto-pull/{idOrSlug}` | No |
| PATCH | `/v1/auto-pull/{idOrSlug}` | No |
| DELETE | `/v1/auto-pull/{idOrSlug}` | No |

---

## Errors

| Status | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed body, invalid filter key or value, bad params |
| 401 | `UNAUTHORIZED` | Missing, invalid, or revoked API key |
| 402 | `PAYMENT_REQUIRED` | Account has never purchased credits |
| 402 | `SPEND_CAP_EXCEEDED` | Key's daily credit cap reached; see `Retry-After` |
| 403 | `FORBIDDEN` | Key valid but action not allowed |
| 404 | `NOT_FOUND` | Unknown event, or no auto-pull rule to delete |
| 429 | `RATE_LIMITED` | Over 60 requests/minute |
| 500 | `INTERNAL_ERROR` | Something broke on our side; safe to retry with the same Idempotency-Key |

Business outcomes that are not errors come back as 400 with `success: false` and a human-readable `message`, for example `"No more contacts to unlock"` or `"No credits remaining"`.

---

## Versioning

Additive changes (new fields, new endpoints, new filter keys) ship in `/v1` without notice; breaking changes would ship as `/v2` with at least 90 days of `/v1` support.

## Changelog

- **2026-07**: Initial public release. ICP filters on every surface, 2-tier pricing (identities + verified emails), single-call bundled email reveal, auto-pull rules with server-side sweeps, incremental sync watermark.
