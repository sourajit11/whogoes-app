# WhoGoes API: Manual Test Plan (Postman)

A follow-along checklist for testing every endpoint and scenario by hand.
Written for Postman; every case shows the request and what you should see.

**Heads up on cost**: running the whole plan spends roughly 15 to 20 credits
on the account whose key you use. All spends are small (2 to 5 credits each).

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
- GET `{{base}}/events?year=2026&industry=Software %26 Technology`
- GET `{{base}}/events?q=modex`
- Expect: the list narrows. Pick your test event here.

**6. Event status**
- GET `{{base}}/events/{slug}/status`
- Expect: `total_contacts`, `contacts_with_email`, `unlocked_count` (0 if you
  have not bought from this event), `user_balance`, `auto_pull_enabled: false`.

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

## E. Pull rules (the "keep new matches coming" feature)

How this works: you save a rule per event (your filters plus spending caps),
then YOUR scheduler calls `POST /pull` as often as you like. Each call buys
only contacts you do not own yet. Nothing runs on WhoGoes' side on a clock;
credits only move when you call.

**19. Create a rule**
- PUT `{{base}}/auto-pull/{slug}`
```json
{ "filters": { "seniority": ["C-Suite", "VP"] }, "max_credits_per_day": 5 }
```
- Expect: the saved rule echoed back, `enabled: true`.

**20. See your rules**
- GET `{{base}}/auto-pull`
- Expect: your rule with `credits_spent_today` and `last_pulled_at`.

**21. Free estimate**
- POST `{{base}}/pull` with body `{ "dry_run": true }`
- Expect: `estimated_credits` and a per-event breakdown. Nothing charged.

**22. Pull now**
- POST `{{base}}/pull` with body `{}`
- Expect: unlocks matching contacts up to the rule's 5-credit daily cap.

**23. Daily cap holds**
- POST `{{base}}/pull` again immediately.
- Expect: `credits_spent: 0` (the rule already hit its cap today).

**24. Pause and resume**
- PATCH `{{base}}/auto-pull/{slug}` with `{ "paused": true }`
- POST `{{base}}/pull` : the paused rule is skipped.
- PATCH again with `{ "paused": false }`.

**25. Scheduled pulls, exactly like a customer would (your own n8n)**
- In your n8n, create a tiny workflow: a Schedule Trigger (every 1 hour)
  connected to an HTTP Request node:
  - Method POST, URL `https://app.whogoes.co/api/v1/pull`
  - Header `Authorization` = `Bearer wg_...` (your key)
  - Body: JSON, `{}`
- Press "Execute workflow" to run it once by hand.
- Expect: a green run whose output shows `credits_spent` and a breakdown.
  With your rule under its daily cap, newly arrived matching contacts get
  bought; if nothing new arrived on the event, `credits_spent` is 0 and
  nothing is charged (that is normal and safe).
- Run it again immediately: expect 0 spent (nothing new, or the daily cap).
- Leave the schedule on overnight and check Executions the next day: runs
  every hour, all green, spending only when the event actually grew. This is
  the exact setup a customer would build in n8n, Zapier, or a cron job.

**26. Delete the rule**
- DELETE `{{base}}/auto-pull/{slug}` : expect `deleted: true`.
- DELETE again: expect 404 (already gone).
- GET `{{base}}/auto-pull` : list no longer shows it.

---

## F. Getting everything into your own system (the sync feed)

**27. The watermark loop**
- GET `{{base}}/contacts?since=1970-01-01T00:00:00Z&limit=200`
- Expect: every contact you own, oldest first, plus a `watermark` timestamp.
- Save the watermark, then call again with `since=<that watermark>`.
- Expect: empty list (nothing new yet).
- Unlock 1 more contact anywhere (Test 15), repeat the call.
- Expect: exactly that new contact appears. This is the loop a customer's
  CRM/n8n/Zapier would run on a schedule.

**28. Scope the feed to one event**
- GET `{{base}}/contacts?event={slug}&limit=50`
- Expect: only that event's contacts.

---

## G. Wrap-up

**29. Docs match reality**
- Open https://app.whogoes.co/docs/api and spot-check it against what you saw.

**30. Revoked key goes dead**
- Revoke your test key in Dashboard > Integrations.
- Any request: expect 401 immediately.

---

## If something looks wrong

Note the test number, the exact request, and the response body, and flag it.
Nothing in this plan can affect other customers: every unlock, rule, and
charge touches only the account behind your key.
