# WhoGoes Public API

Trade show and event attendee lists, with proof, over REST. Browse the same events you see in the app, check exactly who matches your ICP filters, unlock contacts with verified emails, and keep pulling new matches on whatever schedule you run. Credits are deducted from your WhoGoes account as you unlock, and you never pay twice for the same contact.

**Base URL**: `https://app.whogoes.co/api/v1`

The API mirrors the app. Every value you see in the dashboard (statuses, filter options, counts) is the same value you pass here. All responses are JSON:

- Success: `{ "data": ... }`
- Error: `{ "error": { "code": "...", "message": "..." } }`

---

## Quick start

You need an API key first: buy credits at [/dashboard/billing](https://app.whogoes.co/dashboard/billing), then create a key at [/dashboard/integrations](https://app.whogoes.co/dashboard/integrations). That is the only time you need the app; everything below is pure API.

```bash
export WG_KEY="wg_your_actual_key_here"

# 1. Find an event (same filters as the Browse Events page)
curl -H "Authorization: Bearer $WG_KEY" \
  "https://app.whogoes.co/api/v1/events?status=active&q=black%20hat"

# 2. Unlock 25 contacts matching your ICP, verified emails included
curl -X POST \
  -H "Authorization: Bearer $WG_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"count": 25, "filters": {"seniority": ["C-Suite", "VP"], "has_email": true}}' \
  https://app.whogoes.co/api/v1/events/black-hat-usa-2026/unlock

# 3. Fetch the contacts you now own
curl -H "Authorization: Bearer $WG_KEY" \
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/contacts?limit=100"
```

The unlock response tells you exactly what happened and what it cost (here: 25 identities + 25 verified emails = 50 credits):

```json
{
  "data": {
    "success": true,
    "message": "25 contacts unlocked",
    "contacts_unlocked": 25,
    "emails_included": 0,
    "emails_revealed": 25,
    "credits_spent": 50,
    "new_balance": 950,
    "batch_id": "85e0e828-90d6-4f42-97f2-b883d58e5615",
    "no_icp": false,
    "has_more": true
  }
}
```

---

## Endpoints at a glance

| Method | Path | What it does | Costs credits? |
|---|---|---|---|
| GET | `/v1/events` | Browse events, same filters as the app | No |
| GET | `/v1/events/{idOrSlug}/status` | Live totals for one event plus your position on it | No |
| GET | `/v1/events/{idOrSlug}/filter` | Apply ICP filters, see matches and cost before buying | No |
| POST | `/v1/events/{idOrSlug}/unlock` | Buy contacts | Yes |
| POST | `/v1/events/{idOrSlug}/reveal-emails` | Buy emails for contacts you own | Yes |
| GET | `/v1/events/{idOrSlug}/contacts` | Read what you own on one event | No |
| GET | `/v1/contacts` | Read everything you own, or sync incrementally | No |
| GET | `/v1/credits` | Balance and daily cap state | No |

---

## Authentication

Every request needs a Bearer token in the `Authorization` header:

| Header | Value |
|---|---|
| `Authorization` | `Bearer wg_a1b2c3d4...` |
| `Content-Type` | `application/json` (POST requests only) |

Keys are 67-character strings beginning with `wg_`. A key is shown once at creation and only its SHA-256 hash is stored. Lose it and you revoke and create a new one.

**Eligibility**: API access requires having purchased credits at least once. Free trial credits do not unlock the API.

**Managing keys**: create, rename, cap, and revoke keys at [/dashboard/integrations](https://app.whogoes.co/dashboard/integrations). Up to 5 active keys per account. Each key can carry an optional daily credit cap (see Rate limits and spend caps).

Example response when the key is missing or wrong, always JSON, never a login redirect:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or revoked API key."
  }
}
```

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
- Partial fulfillment, never overdraft: if your balance (or a cap) covers less than you asked for, you get what fits and are charged only for that.
- Contacts are unlocked best first: verified email holders first, then most recent activity.

---

## ICP filters reference

The same filter object works everywhere: unlock bodies, filter queries, and contact reads. These are the same filters you see on an event page in the app.

| Key | Type | Values |
|---|---|---|
| `seniority` | array | `C-Suite`, `Owner/Founder`, `VP`, `Director`, `Manager`, `IC`, `Other`, `Unknown` |
| `function` | array | `Sales/BD`, `Marketing`, `Operations`, `Finance`, `Engineering/Technical`, `Product`, `IT/Data`, `HR/People`, `Legal/Compliance`, `Procurement/Supply Chain`, `Customer Success`, `Creative & Content`, `Executive/General Mgmt`, `Other`, `Unknown` |
| `industry` | array | Company industry buckets as shown in the app's Industry filter, e.g. `Software & IT Services`, `Industrial Machinery & Automation`, `Media & Entertainment`. Call the filter endpoint to see the buckets present on your event (`by_industry`). `Unknown` matches uncategorized. |
| `size` | array | Company size buckets: `1-10`, `11-50`, `51-200`, `201-500`, `501-1000`, `1001-5000`, `5001-10000`, `10001+`, `Unknown` |
| `country` | array | Contact country names as returned by the filter endpoint (`by_country`). `Unknown` matches missing. |
| `role` | array | `organizer`, `sponsor`, `exhibitor`, `attendee`, `expected_attendee` |
| `speaker` | boolean | `true` limits to speakers |
| `has_email` | boolean | `true` limits to contacts with a verified email |
| `title_keyword` | string | Case-insensitive match against job title or headline |
| `company_include` | string | Company name must contain this |
| `company_exclude` | string | Company name must not contain this |

An absent key means no constraint. `role: attendee` means the person posted or was tagged about attending; `expected_attendee` means weaker evidence (a bare repost).

Note that a contact's company `industry` (above) and an event's `industry` (on `GET /v1/events`) are different vocabularies, exactly like in the app: events use the 21 event categories from the Browse page, contacts use company industry buckets from the event's filter panel.

**In GET requests** use query params. Array values are comma-separated and params are repeatable:

```
GET /v1/events/black-hat-usa-2026/filter?seniority=C-Suite,VP&function=Sales/BD&has_email=true
```

If a value itself contains a comma, pass the whole object as URL-encoded JSON instead: `?filters=%7B%22seniority%22%3A%5B%22C-Suite%22%5D%7D`. The `filters` param replaces all individual params. Unknown keys return a 400 listing valid keys.

**In POST bodies** pass the object under `"filters"`.

---

## Events

All read endpoints are free.

### `GET /v1/events`

Browse events. Mirrors the app's Browse Events page exactly: same statuses, same search, same default ordering (active events first, upcoming first, biggest list first).

**Query parameters**

| Parameter | Type | Required | Description | Example |
|---|---|---|---|---|
| `status` | string | No | `active` (list still growing) or `completed` (event finished, list final). Same two values as the Status dropdown in the app. Omit for all events, active first. | `active` |
| `q` | string | No | Search by event name or location, like the app search box. | `black hat` |
| `year` | integer | No | Event year. | `2026` |
| `region` | string | No | `US`, `EU`, or `APAC`. UK and European events are under `EU`. | `US` |
| `country` | string | No | Full country name. | `United States` |
| `industry` | string | No | One of the 21 event categories listed below. Remember to URL-encode `&` as `%26`. | `Technology %26 SaaS` |
| `min_contacts` | integer | No | Only events with at least this many contacts. | `300` |
| `starts_after` | date | No | `YYYY-MM-DD`. | `2026-08-01` |
| `starts_before` | date | No | `YYYY-MM-DD`. | `2026-12-31` |
| `limit` | integer | No | Page size, default 50, max 200. | `20` |
| `offset` | integer | No | Pagination offset, default 0. | `0` |

The 21 event categories (same list as the Browse page's Industry dropdown):
`Healthcare & Medical`, `Pharma & Life Sciences`, `Technology & SaaS`, `Cybersecurity`, `AI & Data`, `Manufacturing & Industrial`, `Supply Chain & Logistics`, `Retail & E-commerce`, `Finance & FinTech`, `Marketing, Sales & MarTech`, `Legal & LegalTech`, `Construction & Real Estate`, `Energy, Sustainability & CleanTech`, `Automotive & Mobility`, `Aerospace & Defense`, `Food, Beverage & Agriculture`, `Hospitality, Travel & Events`, `Media, Entertainment & Gaming`, `Education & HR`, `Beauty, Fashion & Consumer Goods`, `Cannabis`.

**Example request**

```bash
curl -H "Authorization: Bearer $WG_KEY" \
  "https://app.whogoes.co/api/v1/events?status=active&industry=Cybersecurity&limit=2"
```

**Example response** (200)

```json
{
  "data": {
    "events": [
      {
        "event_id": "01109f9a-5aa0-47fc-9ef8-9d59b75936e1",
        "event_name": "Black Hat USA 2026",
        "event_slug": "black-hat-usa-2026",
        "event_year": 2026,
        "event_region": "US",
        "event_country": "United States",
        "event_location": "Las Vegas",
        "event_start_date": "2026-08-01",
        "event_industry": "Cybersecurity",
        "status": "active",
        "total_contacts": 2340,
        "contacts_with_email": 1959,
        "counts_cached_at": "2026-07-19T06:15:00.117235+00:00"
      },
      {
        "event_id": "32a569f3-02c0-47a5-a08f-8b76d134c3cc",
        "event_name": "DEF CON 34",
        "event_slug": "def-con-34",
        "event_year": 2026,
        "event_region": "US",
        "event_country": "United States",
        "event_location": "Las Vegas",
        "event_start_date": "2026-08-06",
        "event_industry": "Cybersecurity",
        "status": "active",
        "total_contacts": 994,
        "contacts_with_email": 717,
        "counts_cached_at": "2026-07-19T06:15:00.117235+00:00"
      }
    ],
    "total": 12,
    "limit": 2,
    "offset": 0,
    "has_more": true
  }
}
```

List counts are refreshed on a schedule (see `counts_cached_at`); the filter endpoint is the live truth for a specific event. Completed events stay fully usable: you can still filter, unlock, and read contacts on them, exactly like in the app.

### `GET /v1/events/{idOrSlug}/status`

Live totals for one event plus your position on it. Event routes accept either the event UUID or its slug.

**Example request**

```bash
curl -H "Authorization: Bearer $WG_KEY" \
  https://app.whogoes.co/api/v1/events/black-hat-usa-2026/status
```

**Example response** (200)

```json
{
  "data": {
    "total_contacts": 2340,
    "contacts_with_email": 1959,
    "unlocked_count": 150,
    "emails_unlocked": 150,
    "remaining_count": 2190,
    "user_balance": 4552
  }
}
```

**Response fields**

| Field | Meaning |
|---|---|
| `total_contacts` | Everyone on this event's list |
| `contacts_with_email` | How many of them have a verified email |
| `unlocked_count` | Contacts you own on this event |
| `emails_unlocked` | How many of your contacts have their email unlocked |
| `remaining_count` | Contacts you do not own yet |
| `user_balance` | Your current credit balance |

### `GET /v1/events/{idOrSlug}/filter`

Apply ICP filters and see exactly what you would get before spending anything: live match counts, how many you already own, and the same breakdowns you see on an event page in the app.

**Query parameters**: any ICP filter (see the reference above). No filters = the whole event.

**Example request**

```bash
curl -H "Authorization: Bearer $WG_KEY" \
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/filter?seniority=C-Suite,VP&has_email=true"
```

**Example response** (200, abbreviated)

```json
{
  "data": {
    "matched": 26,
    "with_email": 26,
    "owned": 0,
    "by_seniority": [
      { "key": "C-Suite", "count": 18 },
      { "key": "VP", "count": 8 }
    ],
    "by_function": [
      { "key": "Executive/General Mgmt", "count": 17 },
      { "key": "Sales/BD", "count": 7 },
      { "key": "Operations", "count": 2 }
    ],
    "by_role": [
      { "key": "exhibitor", "count": 10 },
      { "key": "expected_attendee", "count": 9 },
      { "key": "attendee", "count": 5 },
      { "key": "sponsor", "count": 2 }
    ],
    "by_industry": [ { "key": "Software & IT Services", "count": 12 } ],
    "by_size": [ { "key": "51-200", "count": 9 } ],
    "by_country": [ { "key": "United States", "count": 21 } ],
    "top_companies": [ { "key": "Meridian Security", "count": 3 } ]
  }
}
```

How to read it: `matched` minus `owned` is how many new contacts an unlock with these filters would deliver. Cost for a filtered unlock with emails is at most `(matched - owned) + with_email` among the new ones; the unlock response reports the exact spend.

An invalid filter value returns a 400 that lists the valid values:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid role value(s): ceo. Valid roles: organizer, sponsor, exhibitor, attendee, expected_attendee"
  }
}
```

---

## Unlocking and revealing

### `POST /v1/events/{idOrSlug}/unlock`

Spends credits. Unlocks up to `count` contacts you do not own yet on this event, best first (verified email holders first, then most recent activity). An unlock is always scoped to one event.

**Headers**

| Header | Required | Description |
|---|---|---|
| `Authorization` | Yes | `Bearer wg_...` |
| `Content-Type` | Yes | `application/json` |
| `Idempotency-Key` | Recommended | Any unique string (a UUID is ideal). Retrying with the same key returns the original response with `Idempotency-Replayed: true` and never double-charges. |

**Body parameters**

| Parameter | Type | Required | Description | Example |
|---|---|---|---|---|
| `count` | integer | Yes | 1 to 10000. Large requests are processed in server-side chunks within one call. | `100` |
| `filters` | object | No | The ICP filter object. Omit for a full-list unlock (emails included at 1 credit per contact). | `{"seniority": ["C-Suite"]}` |
| `include_emails` | boolean | No | Default `true`. On filtered unlocks, bundle the email reveal (+1 credit per contact with a verified email) into this call. Set `false` to buy identities only and reveal selectively later. | `true` |

**Example request**

```bash
curl -X POST \
  -H "Authorization: Bearer $WG_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "count": 100,
    "filters": { "seniority": ["C-Suite", "VP"], "industry": ["Software & IT Services"] },
    "include_emails": true
  }' \
  https://app.whogoes.co/api/v1/events/black-hat-usa-2026/unlock
```

**Example response** (200)

```json
{
  "data": {
    "success": true,
    "message": "100 contacts unlocked",
    "contacts_unlocked": 100,
    "emails_included": 0,
    "emails_revealed": 87,
    "credits_spent": 187,
    "new_balance": 4365,
    "batch_id": "0f2e602e-4766-4f55-b289-d4858ebe0bb7",
    "no_icp": false,
    "has_more": true
  }
}
```

**Response fields**

| Field | Meaning |
|---|---|
| `contacts_unlocked` | New contacts you now own from this call |
| `emails_included` | Emails that came free (unfiltered pricing path) |
| `emails_revealed` | Emails charged at +1 credit (filtered pricing path) |
| `credits_spent` | Exact total charged for this call |
| `new_balance` | Your balance after this call |
| `batch_id` | This unlock as a batch; the same history is visible in the dashboard |
| `no_icp` | `true` when the request priced as an unfiltered unlock (no filters, or only `has_email`) |
| `has_more` | `true` while contacts matching your filters remain that you do not own yet |

**Example response** when the filter pool is used up (400, nothing charged)

```json
{
  "data": {
    "success": false,
    "message": "No more contacts to unlock"
  }
}
```

### `POST /v1/events/{idOrSlug}/reveal-emails`

Spends credits. Reveals verified emails for contacts you own that do not have their email tier unlocked yet. 1 credit per email actually revealed. Scope it three ways: specific contacts, a filter object, or an empty body to reveal everything eligible on the event.

**Body parameters**

| Parameter | Type | Required | Description | Example |
|---|---|---|---|---|
| `contact_ids` | array | No | Specific contact UUIDs. | `["9b0708e8-..."]` |
| `filters` | object | No | Reveal for everyone you own matching this ICP filter. | `{"seniority": ["C-Suite"]}` |

**Example request**

```bash
curl -X POST -H "Authorization: Bearer $WG_KEY" -H "Content-Type: application/json" \
  -d '{"contact_ids": ["9b0708e8-7b74-453f-a69a-2f6a95ce46be"]}' \
  https://app.whogoes.co/api/v1/events/black-hat-usa-2026/reveal-emails
```

**Example response** (200)

```json
{
  "data": {
    "success": true,
    "emails_revealed": 1,
    "credits_spent": 1,
    "new_balance": 4563,
    "revealed": [
      {
        "contact_id": "9b0708e8-7b74-453f-a69a-2f6a95ce46be",
        "email": "jordan@meridiansecurity.com"
      }
    ]
  }
}
```

Revealing the same contact again returns a 400 with `"No emails to reveal"` and charges nothing.

---

## Reading your contacts

### `GET /v1/events/{idOrSlug}/contacts`

Your unlocked contacts for one event. Free.

**Query parameters**

| Parameter | Type | Required | Description | Example |
|---|---|---|---|---|
| Any ICP filter | | No | Narrow to matching contacts you own. | `seniority=C-Suite` |
| `sort` | string | No | `unlocked_at` (default), `full_name`, `current_title`, `company_name`, `post_date`, `email`. | `post_date` |
| `dir` | string | No | `asc` or `desc`. | `desc` |
| `limit` | integer | No | Max 100. | `100` |
| `offset` | integer | No | Default 0. | `0` |

**Example request**

```bash
curl -H "Authorization: Bearer $WG_KEY" \
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/contacts?sort=post_date&dir=desc&limit=1"
```

**Example response** (200, one contact shown)

```json
{
  "data": {
    "contacts": [
      {
        "contact_id": "9b0708e8-7b74-453f-a69a-2f6a95ce46be",
        "full_name": "Jordan Reyes",
        "first_name": "Jordan",
        "last_name": "Reyes",
        "current_title": "Chief Information Security Officer",
        "headline": "CISO at Meridian Security",
        "contact_linkedin_url": "https://www.linkedin.com/in/jordan-reyes",
        "city": "Austin",
        "country": "United States",
        "email": "jordan@meridiansecurity.com",
        "email_status": "valid",
        "email_provider": "google",
        "has_email": true,
        "email_unlocked": true,
        "company_name": "Meridian Security",
        "company_linkedin_url": "https://www.linkedin.com/company/meridian-security",
        "company_domain": "meridiansecurity.com",
        "company_website": "https://www.meridiansecurity.com",
        "company_industry": "Computer & Network Security",
        "company_industry_bucket": "Software & IT Services",
        "company_size": "51-200",
        "company_size_bucket": "51-200",
        "company_headquarters": "Austin, Texas",
        "company_founded_year": 2014,
        "event_role": "attendee",
        "is_speaker": false,
        "post_url": "https://www.linkedin.com/posts/activity-7483880826611412992-uBzz",
        "post_content": "Las Vegas bound! I will be at Black Hat USA this August with the Meridian team. If you want to talk security operations, my DMs are open. #BlackHat2026",
        "post_date": "2026-07-17T13:50:32.846+00:00",
        "source": "post_author",
        "unlocked_at": "2026-07-19T06:48:19.34118+00:00",
        "batch_id": "eeebea41-cd02-4a49-bf12-bab4472792f0"
      }
    ],
    "total": 150,
    "limit": 1,
    "offset": 0,
    "has_more": true
  }
}
```

The proof is always attached: `post_url` links the LinkedIn post where this person said they are going, and `post_content` carries the full text of that post, never truncated (ready-made personalization for your outreach). Email handling:

- `email`, `email_status`, `email_provider` are present only when `email_unlocked` is `true`.
- `has_email: true` with `email_unlocked: false` means a verified email exists and one reveal credit buys it.

### `GET /v1/contacts`

Everything you own across all events, same contact payload as above plus `event_id`, `event_slug`, `event_name` on each row. Free. With `since` it becomes the incremental sync feed (see Syncing on a schedule below).

**Query parameters**

| Parameter | Type | Required | Description | Example |
|---|---|---|---|---|
| `since` | timestamp | No | ISO 8601. Only contacts unlocked strictly after this moment, oldest first. Pass the `watermark` from your previous call, exactly as you received it. Without `since`, newest first. | `2026-07-19T06:49:11.503241+00:00` |
| `event` | string | No | Event UUID or slug to scope to one event. | `black-hat-usa-2026` |
| `limit` | integer | No | Max 200. | `200` |
| `offset` | integer | No | Default 0. | `0` |

**Example request**

```bash
curl -H "Authorization: Bearer $WG_KEY" \
  "https://app.whogoes.co/api/v1/contacts?since=2026-07-18T00:00:00Z&limit=200"
```

**Example response** (200, abbreviated)

```json
{
  "data": {
    "contacts": [
      {
        "contact_id": "9b0708e8-7b74-453f-a69a-2f6a95ce46be",
        "full_name": "Jordan Reyes",
        "current_title": "Chief Information Security Officer",
        "company_name": "Meridian Security",
        "email": "jordan@meridiansecurity.com",
        "email_unlocked": true,
        "event_id": "01109f9a-5aa0-47fc-9ef8-9d59b75936e1",
        "event_slug": "black-hat-usa-2026",
        "event_name": "Black Hat USA 2026",
        "unlocked_at": "2026-07-19T06:48:19.34118+00:00"
      }
    ],
    "total": 431,
    "limit": 200,
    "offset": 0,
    "since": "2026-07-18T00:00:00+00:00",
    "watermark": "2026-07-19T06:49:11.503241+00:00",
    "has_more": true
  }
}
```

When many contacts were unlocked in the same instant (one bulk unlock), a page can exceed `limit` so the watermark always covers everything delivered; size your client buffers accordingly.

---

## Syncing on a schedule

Events on WhoGoes keep growing as more people post that they are attending. There is no subscribe call and nothing runs on our side on a clock. Staying in sync is two calls that you schedule yourself (cron, n8n, Zapier, anything), and they are both safe to re-run forever:

1. **Re-run your unlock, per event.** An unlock is always scoped to one event. Because you never pay twice, re-sending the exact same unlock buys only people who arrived since your last run, and spends nothing when nobody new matches. Working three events? That is three scheduled unlocks, one per event.
2. **Drain everything new with one account-wide call.** `GET /v1/contacts?since=<watermark>` returns every contact you gained since your last drain, across all events, whichever unlock bought them.

A concrete run. Say your saved search on Black Hat is C-Suite and VP with emails. Check what a run would do (free):

```bash
curl -H "Authorization: Bearer $WG_KEY" \
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/filter?seniority=C-Suite,VP&has_email=true"
# -> { "matched": 40, "owned": 25, ... }   15 new people since your last run
```

Buy the newcomers (same call as your first unlock, just re-sent):

```bash
curl -X POST -H "Authorization: Bearer $WG_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"count": 500, "filters": {"seniority": ["C-Suite", "VP"], "has_email": true}}' \
  https://app.whogoes.co/api/v1/events/black-hat-usa-2026/unlock
# -> { "contacts_unlocked": 15, "credits_spent": 15, "has_more": false, ... }
```

Set `count` to more than you expect (500 here); you are only charged for what is actually delivered, 15 in this run. When nothing new matches, the same call returns a 400 with `"No more contacts to unlock"` and charges nothing, which is exactly what most scheduled runs will do. Then collect what you now own into your system:

```bash
# First ever run: everything you own
curl -H "Authorization: Bearer $WG_KEY" \
  "https://app.whogoes.co/api/v1/contacts?since=1970-01-01T00:00:00Z&limit=200"

# Every later run: only what is new since the stored watermark
curl -H "Authorization: Bearer $WG_KEY" \
  "https://app.whogoes.co/api/v1/contacts?since=$LAST_WATERMARK&limit=200"
```

Keep requesting with each response's new `watermark` until you get an empty page, then store the last watermark for the next run. The feed never duplicates and never skips.

Cost stays fully in your hands: the filter endpoint tells you before any run how many new matches exist, and a per-key daily credit cap (set in the dashboard) is a hard stop no matter what your scheduler does. Use a fresh `Idempotency-Key` per scheduled run; reusing one replays the earlier response instead of buying again, which is also your safety net for retries.

---

## Credits

### `GET /v1/credits`

Your balance and this key's daily cap state. Free.

**Example request**

```bash
curl -H "Authorization: Bearer $WG_KEY" https://app.whogoes.co/api/v1/credits
```

**Example response** (200)

```json
{
  "data": {
    "balance": 4552,
    "daily_cap": 200,
    "spent_today": 50,
    "remaining_today": 150
  }
}
```

`daily_cap` and `remaining_today` are `null` when the key has no cap.

---

## Rate limits and spend caps

| Guardrail | Default | Configurable | Window | On exceed |
|---|---|---|---|---|
| Request rate | 60 req/min per key | No | sliding 60 s | 429 `RATE_LIMITED` |
| Credit spend | unlimited | Yes, per key | UTC day | 402 `SPEND_CAP_EXCEEDED` with `Retry-After` |

Successful responses include `X-RateLimit-Remaining`. The 402 `Retry-After` header counts the seconds to the next UTC midnight.

```json
{
  "error": {
    "code": "SPEND_CAP_EXCEEDED",
    "message": "Daily credit cap reached for this API key. Resets at UTC midnight."
  }
}
```

---

## Errors

| Status | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed body, invalid filter key or value, bad params |
| 401 | `UNAUTHORIZED` | Missing, invalid, or revoked API key |
| 402 | `PAYMENT_REQUIRED` | Account has never purchased credits |
| 402 | `SPEND_CAP_EXCEEDED` | Key's daily credit cap reached; see `Retry-After` |
| 403 | `FORBIDDEN` | Key valid but action not allowed |
| 404 | `NOT_FOUND` | Unknown event |
| 429 | `RATE_LIMITED` | Over 60 requests/minute |
| 500 | `INTERNAL_ERROR` | Something broke on our side; safe to retry with the same Idempotency-Key |

Business outcomes that are not errors come back as 400 with `success: false` and a human-readable `message`, for example `"No more contacts to unlock"` or `"No emails to reveal"`. Nothing is ever charged on those.

---

## Versioning

Additive changes (new fields, new endpoints, new filter keys) ship in `/v1` without notice; breaking changes would ship as `/v2` with at least 90 days of `/v1` support.

## Changelog

- **2026-07-19**: Contact payloads now include `post_content`, the full text of the proof post, never truncated. The pre-purchase counts endpoint is now `GET /v1/events/{idOrSlug}/filter` (the old `/facets` path still works). `/v1/events` now mirrors the Browse Events page exactly: new `status` filter (`active` / `completed`, same values as the app), every event listed, `status` field on each row, browse-page ordering, `q` matches location too, new `min_contacts` param. Sync feed watermark hardened for bulk unlocks (a page can exceed `limit` to keep the watermark exact).
- **2026-07**: Initial public release. ICP filters on every surface, 2-tier pricing (identities + verified emails), single-call bundled email reveal, scheduler-friendly syncing with the incremental watermark feed.
