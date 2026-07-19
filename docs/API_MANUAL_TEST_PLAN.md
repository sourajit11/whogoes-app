# WhoGoes API: Manual Test Plan (Postman)

A follow-along checklist for testing every endpoint and scenario by hand.
Written for Postman; every case shows the request and what you should see.

**Heads up on cost**: running the whole plan spends roughly 10 to 15 credits
on the account whose key you use. All spends are small (1 to 4 credits each).

---

## Setup (5 minutes)

1. **Get a key**: log into app.whogoes.co, go to Dashboard, then Integrations,
   click Create key. Copy the `wg_...` value immediately (it is shown once).
   Key creation needs an account that has purchased credits at least once.
2. **Postman collection**: create a collection with two variables:
   - `base` = `https://app.whogoes.co/api/v1`
   - `key` = your `wg_...` key
3. On the collection's Authorization tab pick **Bearer Token** and set it to
   `{{key}}`. Every request below inherits it.
4. **Pick a test event**: run Test 5 first and choose a smallish event
   (a few hundred contacts) so spends stay tiny. Use its `event_slug`
   everywhere you see `{slug}` below.

---

## A. Keys and access

**1. No key**
- GET `{{base}}/credits` with Authorization turned off for this request.
- Expect: HTTP 401 with a JSON error, NOT a login page or redirect.

**2. Wrong key**
- Same request, Bearer token `wg_wrong123456789012345`.
- Expect: 401 "Invalid or revoked API key."

**3. Valid key**
- GET `{{base}}/credits` with your real key.
- Expect: 200 with `balance`, `daily_cap`, `spent_today`, `remaining_today`.
- Write down `balance`; you will check the math against it later.

---

## B. Finding events and people (all free)

**4. Browse events**
- GET `{{base}}/events?limit=10`
- Expect: list of events with `event_slug`, dates, `total_contacts`,
  `contacts_with_email`.

**5. Browse with filters**
- GET `{{base}}/events?year=2026&industry=Technology %26 SaaS`
  (the `&` inside the industry name must be sent as `%26`; in Postman use the
  Params tab with value `Technology & SaaS` and it encodes for you)
- GET `{{base}}/events?q=fintech` (or any event name you saw in Test 4 —
  search only returns events that are still active, so past events will
  come back empty)
- Expect: the list narrows. Pick your test event here.

**6. Event status**
- GET `{{base}}/events/{slug}/status`
- Expect: `total_contacts`, `contacts_with_email`, `unlocked_count` (0 if you
  have not bought from this event), `user_balance`.

**7. Facets (the "who is here" breakdown)**
- GET `{{base}}/events/{slug}/facets`
- Expect: `matched`, `with_email`, `owned`, plus breakdowns by seniority,
  function, role, industry, size, country, top companies.
- Now add filters and watch the numbers shrink:
  GET `{{base}}/events/{slug}/facets?seniority=C-Suite,VP&has_email=true`

**8. Bad filter is rejected clearly**
- GET `{{base}}/events/{slug}/facets?role=ceo`
- Expect: 400 telling you the valid role values.

**9. Preview**
- GET `{{base}}/events/{slug}/preview?limit=5&seniority=C-Suite`
- Expect: a few sample people, partially redacted, no emails anywhere.

---

## C. Buying contacts (spends credits)

For all POSTs: Body tab, raw, JSON.

**10. Filtered unlock WITHOUT emails (1 credit per person)**
- POST `{{base}}/events/{slug}/unlock`
```json
{ "count": 2, "filters": { "seniority": ["C-Suite", "VP", "Director"] }, "include_emails": false }
```
- Expect: `contacts_unlocked: 2`, `credits_spent: 2`, `emails_revealed: 0`,
  `new_balance` = old balance minus 2.

**11. Read what you bought**
- GET `{{base}}/events/{slug}/contacts`
- Expect: your 2 contacts with names, titles, LinkedIn, company info, and the
  proof (`post_url`). `email` is null, `email_unlocked` is false. Where
  `has_email` is true, an email exists and costs 1 credit to reveal.
- Copy one `contact_id` where `has_email` is true.

**12. Reveal one email (+1 credit)**
- POST `{{base}}/events/{slug}/reveal-emails`
```json
{ "contact_ids": ["PASTE-CONTACT-ID"] }
```
- Expect: `emails_revealed: 1`, `credits_spent: 1`, and the actual email in
  `revealed`. Re-run Test 11: that contact now shows its email.

**13. No double charging on reveal**
- Send Test 12 again, same contact.
- Expect: 400 "No emails to reveal", nothing charged.

**14. Filtered unlock WITH emails in one call (1 + 1 pricing)**
- POST `{{base}}/events/{slug}/unlock`
```json
{ "count": 2, "filters": { "seniority": ["C-Suite", "VP", "Director"] } }
```
- Expect: 2 new people (never the ones you already own), and
  `credits_spent` = 2 + however many of them had emails (so 2, 3, or 4).
  Test 11 now shows their emails immediately.

**15. Full-list unlock (email included at 1 credit)**
- POST `{{base}}/events/{slug}/unlock` with body `{ "count": 2 }`
- Expect: `credits_spent: 2`, `emails_included: 2`, emails visible right away.

**16. Retries never double-charge (idempotency)**
- POST `{{base}}/events/{slug}/unlock`, body `{ "count": 1 }`, and add header
  `Idempotency-Key: my-test-123`.
- Send it TWICE.
- Expect: identical responses; the second has response header
  `Idempotency-Replayed: true`. Check `{{base}}/credits`: charged once only.

**17. Balance check**
- GET `{{base}}/credits`
- Expect: balance dropped by exactly the sum of `credits_spent` above.

---

## D. Spending limits

**18. Daily cap on a key**
- In Dashboard > Integrations set your key's daily cap to 3.
- POST an unlock with `{ "count": 10 }`.
- Expect: either a small partial unlock (up to the cap) or 402
  `SPEND_CAP_EXCEEDED` if the cap is already used up today.
- Remove the cap afterwards.

---

## E. Scheduled syncing (keep new matches coming)

How this works: a contact can never be bought twice, so "get me the new
people" is simply re-running your unlock on a schedule. Each run buys only
people who arrived since your last run, and spends nothing when nothing new
matches. Nothing runs on WhoGoes' side on a clock; credits only move when
you call.

**19. Re-running an unlock buys only newcomers**
- Send the exact unlock from Test 14 again (same filters, count 2).
- Expect: either 2 people you did NOT already own, or, once the filter pool
  is used up, a 400 with "No more contacts to unlock" and nothing charged.
- Keep re-sending until you get that 400: this is the proof that a scheduled
  call is always safe. It can never re-buy or overspend.

**20. Know the cost before any run**
- GET `{{base}}/events/{slug}/facets?seniority=C-Suite,VP,Director`
- Expect: `matched` and `owned`. New people the next run would buy =
  matched minus owned. When they are equal, the next run costs nothing.

**21. A real schedule, exactly like a customer would (your own n8n)**
- In your n8n, create a tiny workflow: a Schedule Trigger (every 1 hour)
  connected to an HTTP Request node:
  - Method POST, URL `https://app.whogoes.co/api/v1/events/{slug}/unlock`
  - Header `Authorization` = `Bearer wg_...` (your key)
  - Body: JSON, `{ "count": 100, "filters": { "seniority": ["C-Suite", "VP", "Director"] } }`
- Press "Execute workflow" once by hand.
- Expect: a green run; the output shows `contacts_unlocked` and
  `credits_spent` (0 spend and a "No more contacts" result is normal once
  the pool is exhausted).
- Leave the schedule on overnight and check Executions the next day: hourly
  green runs, spending only when the event actually grew. This is the exact
  setup a customer would build in n8n, Zapier, or a cron job. As a guard,
  set a daily credit cap on the key (Test 18) so no scheduler bug can ever
  overspend.

## F. Getting everything into your own system (the sync feed)

**22. The watermark loop**
- GET `{{base}}/contacts?since=1970-01-01T00:00:00Z&limit=200`
- Expect: every contact you own, oldest first, plus a `watermark` timestamp.
- Save the watermark, then call again with `since=<that watermark>`.
- Expect: empty list (nothing new yet).
- Unlock 1 more contact anywhere (Test 15), repeat the call.
- Expect: exactly that new contact appears. Paired with the scheduled unlock
  from Test 21, this is the complete customer pipeline.

**23. Scope the feed to one event**
- GET `{{base}}/contacts?event={slug}&limit=50`
- Expect: only that event's contacts.

## G. Wrap-up

**24. Docs match reality**
- Open https://app.whogoes.co/docs/api and spot-check it against what you saw.

**25. Revoked key goes dead**
- Revoke your test key in Dashboard > Integrations.
- Any request: expect 401 immediately.

## If something looks wrong

Note the test number, the exact request, and the response body, and flag it.
Nothing in this plan can affect other customers: every unlock, rule, and
charge touches only the account behind your key.
