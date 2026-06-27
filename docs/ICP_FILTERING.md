# Pre-Unlock ICP Filtering + Event-Role Tagging + 2-Tier Pricing

Lets customers filter an event's attendee list by ICP attributes BEFORE spending credits, unlock only the matches, and reveal verified emails as a separate paid step. Built on data we already enrich.

**Status:** backend + UI complete and on prod (Supabase). The 2-tier pricing is **DORMANT** until a one-line go-live migration ships with the frontend deploy. Original plan: `~/.claude/plans/icp-filtering-and-event-role-tagging.md`.

---

## 1. Data model (added columns / tables)

| Object | Added | Purpose |
|---|---|---|
| `contacts` | `seniority_bucket`, `function_bucket`, `classification_confidence`, `classified_at` | ICP classification |
| `companies` | `industry_bucket`, `size_bucket` | ICP classification (auto-set by trigger) |
| `events` | `organizer_company_id` (FK companies), `organizer_confidence` | brand-matched organizer |
| `contact_events` | `is_speaker` | per-contact speaker flag |
| `posts` | `extracted_event_role`, `role_is_speaker`, `role_evidence`, `role_confidence` | LLM role output per post |
| `company_event_roles` (new) | `event_id, company_id, role, confidence, evidence_post_id, computed_at` | resolved one role per (event, company); RLS on, no policy, accessed via SECURITY DEFINER RPCs |
| `company_industry_bucket_map` (new) | `raw_industry → bucket` | 361-row deterministic industry map |
| `customer_contact_access` | `email_unlocked`, `email_charged_at` | 2-tier: identity vs email |

**Buckets.** Seniority: C-Suite, Owner/Founder, VP, Director, Manager, IC, Other (UI labels IC as "Individual Contributor (Staff)"). Function (14): Sales/BD, Marketing, Operations, Finance, Engineering/Technical, Product, IT/Data, HR/People, Legal/Compliance, Procurement/Supply Chain, Customer Success, Creative & Content, Executive/General Mgmt, Other. Company size: 1-10 … 5000+. Industry: 47 Apollo-style buckets. Event role: organizer > sponsor > exhibitor > attendee.

**Effective per-contact role + "Expected attendee" (2026-06-21).** `company_event_roles.role` stays company-level (4 values). The UI/filter surfaces a 5th **per-contact** value, `expected_attendee`, computed on the fly (no stored column, no backfill) from `contact_events.source_type`: company role wins for sponsor/exhibitor/organizer; otherwise a contact is **Attendee (confirmed)** if they have a first-person post (`source_type='post_author'`), are **mentioned**, or are a speaker, and **Expected attendee** ONLY when their sole evidence is a bare repost (`source_type='repost'`). This implements the strategy's planned `attendee_confidence (Confirmed|Likely)` — see [[icp-attendee-confidence-descoped]]. The CASE lives in `event_filtered_contact_ids` (so facets/preview/role-filter/unlock all inherit it) and is duplicated in `get_subscribed_event_contacts` for My Events. Filter labels: "Attendee (confirmed)" vs "Expected attendee"; table badge: "Attendee" vs muted "Expected". Migrations `20260621162035`/`20260621162106` (initial), refined to reposts-only by `20260621165336`/`20260621165404`. **Limitation:** `source_type` is mechanical (set upstream by the scraper), so reposts are NOT content-analyzed — a repost with clear "I'll be there" commentary is still tagged Expected. The strategy's "content beats source_type" upgrade would need the qualifying-agent LLM to emit an attendance-clarity signal per repost.

---

## 2. Classification (one-time backfill + reusable)

- **Pure lib:** `app/scripts/lib/classify.mjs` — `classifySeniority/Function/Size/Industry` (deterministic + multilingual). Industry map: `app/scripts/company-industry-mapping.json`.
- **Backfill script:** `app/scripts/apply-classification.mjs` (dry-run default, `--apply`, `--event`, self-improvement recommendations). Whole DB is backfilled.
- **Going forward (companies):** the trigger `trg_companies_set_buckets` (migration `..._company_bucket_trigger`) auto-sets `industry_bucket`/`size_bucket` on every company insert/update via `bucket_company_industry()` + `bucket_company_size()`. No n8n change. **Add a new raw industry:** `insert into company_industry_bucket_map (raw_industry,bucket) values (...) on conflict do update`.
- **Going forward (contacts):** classified by the enrichment path / re-run the apply script.

---

## 3. Event-role resolution

**Model.** Company-level ladder, highest credible claim wins. Guardrails: bare reposts + mentions only ever contribute Attendee; the LLM reads first-person intent ("content beats source_type"). Organizer is set ONLY by brand-match (`events.organizer_company_id`), never inferred from a post (the LLM proved unreliable for organizer). Speaker = per-contact.

**Per-post role (the LLM):**
- **Backfill:** `app/scripts/extract-post-roles.mjs` — API-FREE. `--dump` writes candidate-post JSONL chunks; **subagents on the Claude subscription (always `model:"haiku"`)** classify each chunk into `role-labels-*.jsonl`; `--ingest` writes `posts.extracted_event_role`/`role_is_speaker`/`role_evidence`/`role_confidence`, flags speakers, re-resolves. Candidate net = company-page posts OR a broad keyword regex; everything else stays attendee (cost control).
- **Going forward:** both active qualification workflows (`qLTalNnfJ8fOqhcg`, `8Ade8PNYYf060x8H`) emit the 4 role fields from the EXISTING Gemini `informationExtractor` call (no new LLM cost). Same role rules as the subagent prompt.

**Resolution (SQL).** `resolve_company_event_roles(event_id, p_write)` collapses per-post claims into `company_event_roles` (prefers `extracted_event_role`, else Attendee baseline; organizer via brand-match override) AND syncs `posts.role_is_speaker → contact_events.is_speaker`. `suggest_event_organizer(event_id)` = read-only brand-token suggestion. `resolve_active_event_roles(p_days=3)` loops active events; **pg_cron `resolve-event-roles-daily` runs it at 02:30 UTC (08:00 IST)**. Past events (is_active=false) are resolved manually via MCP.

**Done so far.** AWS Public Sector Summit + Cannes Lions 2026 fully resolved. Cannes: 1 organizer / 60 sponsor / 360 exhibitor / 3,022 attendee / 456 speakers.

---

## 4. Filters

**Contract: one `jsonb` param** (extensible, stable signatures). Absent key = no constraint.
```json
{ "seniority":["VP","Director"], "function":["Marketing"], "industry":["Software & IT Services"],
  "size":["1001-5000"], "country":["United States"], "role":["sponsor","exhibitor"],
  "speaker": true, "title_keyword":"growth", "company_include":"acme", "company_exclude":"google" }
```

**Shared helper** `event_filtered_contact_ids(event_id, filters)` (distinct on contact; joins contacts + companies + company_event_roles; role defaults attendee) drives all three RPCs so predicates stay identical:

| RPC | Returns | Notes |
|---|---|---|
| `get_event_filter_facets(event_id, filters)` | json: matched, with_email, by_seniority/function/role/industry/size/country, top_companies | live match summary + breakdown. anon+authed |
| `get_event_filter_preview(event_id, filters, limit)` | json: matched, with_email, `sample` (one fully-named row, identity + post, **no raw email**), `rows` (redacted ICP only) | the pre-unlock tease. anon+authed |
| `unlock_event_contacts(event_id, count, filters)` | unlocks email-first among matches | filters default `{}` = unlock all (legacy). DROPPED old 2-arg, 3-arg now |
| `get_subscribed_event_contacts(..., filters)` | My Events display, filtered | 5-arg now |

---

## 5. Two-tier pricing (identity + email)

**Decision.** Flat "1 credit = contact + email" replaced by: **unlock = 1 credit for IDENTITY** (name, title, company, LinkedIn, View Post); **email = +1 credit, opt-in**, per-contact "Reveal" in My Events. Rationale: only ~70-80% of contacts have a verified email, so the old flat model overcharged no-email contacts; the email is the most valuable asset; identity tier is genuinely actionable for LinkedIn/social outreach.

- `unlock_event_contacts` inserts `customer_contact_access` rows; `email_unlocked` comes from the column default. The email is the same 1-credit unlock charge as before — the email is the NEW second charge.
- `reveal_event_emails(event_id, contact_ids?, filters?)` charges 1 credit per contact, **only** for identity-unlocked contacts that HAVE a valid email and aren't yet revealed (never charges for a missing email). Returns `revealed: [{contact_id, email}]` so the client patches state without refetch.
- `get_subscribed_event_contacts` returns the email **only when `email_unlocked`** (locked emails never leave the server) + adds `has_email` / `email_unlocked`.
- **Grandfathering:** everything unlocked before the change is `email_unlocked=true` (already paid under the old model — never re-charged).

**DORMANCY / GO-LIVE.** `email_unlocked` currently defaults to **true** (migration `..._email_unlock_default_true_until_golive`) so the 2-tier is OFF: new unlocks include the email, no Reveal buttons appear, prod behaves as before. Going live = apply the pending migration `20260621050000_GOLIVE_email_unlock_default_false.sql` (`set default false`) **together with** the frontend deploy. Do NOT apply it early or you create a live regression.

---

## 6. UI

- **`app/.../events/[id]/event-filters.tsx`** — `EventFilters` (multiselect popovers Seniority/Function/Industry/Event role/Company size/Country with per-event counts, Speakers toggle, job-title + company include/exclude inputs, removable chips, live "N of M match (K with email)" summary + collapsible breakdown). Exports `cleanFilters`, `isFilterActive`, `EventFiltersValue`, and `FilteredPreview` (sample row + redacted ICP rows from `get_event_filter_preview`).
- **`event-detail.tsx`** — renders `EventFilters`; when filters active, renders `FilteredPreview` in place of the unfiltered preview, the slider caps at the matched count, the primary button reads "Unlock N Matches" (passes filters), and a secondary "Unlock all (ignore filters)" sends `{}`.
- **`my-events-view.tsx` + `contact-table.tsx`** — email cell shows the email when unlocked, a **"Reveal · 1 cr"** button when `has_email && !email_unlocked`, else "—". `handleRevealEmail` (single) + `handleRevealAll` (toolbar "Reveal N emails · N cr" for the locked set) call `reveal_event_emails` and patch in place. Export/CSV naturally only includes revealed emails.
  - **EventFilters is now wired into My Events** (2026-06-21): the same filter bar scopes the owned-contact table, the "Unlock more" count (filter-aware `remainingForEvent`), and the bulk reveal. Filter changes use **stale-while-revalidate** — the table stays mounted under an "Updating results…" overlay instead of swapping to the full-height loader (`initialLoadDone` gates initial loader vs overlay), fixing the post-filter "freeze". Filter-bar identity is stabilized via a stringify-then-parse memo so a no-op `onChange({})` can't trigger a refetch loop.
  - **Unlocked-events table columns** (2026-06-21): added a **Role** badge column (attendee muted / sponsor amber / exhibitor blue / organizer purple) with a **🎤 speaker mic** rendered next to the badge when the contact spoke; switched **Industry** and **Size** to the standardized buckets (`company_industry_bucket`/`company_size_bucket`, falling back to legacy free-text); **removed HQ + Founded**; and **moved Company Domain / Company LinkedIn / Website / Founded / company description into the expandable row** to cut table width. Driven by `get_subscribed_event_contacts` now returning `event_role`, `company_size_bucket`, `company_industry_bucket` (migration `20260621152242`) and `is_speaker` (migration `20260621154618`). CSV export mirrors this (adds Event Role + Speaker Yes/No, uses buckets, drops HQ + Founded). The Browse-page preview table also dropped HQ + Founded for consistency.
  - **Stats-line clarity** (2026-06-21, rec): when a filter is active, the My Events stats read "**N** of your unlocked contacts match · **M** more match — unlock" (owned-matches vs unlockable), instead of the old event-wide "N match filters" which conflated the two.
  - **Pre-unlock proof surface** (2026-06-21, rec): the Browse event page passes `defaultBreakdownOpen` to `EventFilters` so the composition breakdown (By role / By seniority / By industry / Top companies) is visible above the fold without clicking; My Events leaves it collapsed.

**Tease design (decided; redesigned 2026-06-28).** The filtered preview now mirrors the main contact table — columns: Name · Title · Role · Company · Industry · Size · Location · Email. Per redacted row: SHOW title/role/location/industry/size (+ speaker chip); BLUR name + company; Email reads "Locked". Company caliber proven via the aggregate top_companies breakdown. One fully-named SAMPLE row (identity + company visible, email still locked) as a trust taste. See `docs/EVENT_COUNTS_AND_PREVIEW.md`.

---

## 7. Migrations (chronological)

`20260620182701_add_classification_buckets` · `20260620182723_add_event_role_tagging` · `20260620203613_role_resolution_functions` · `20260620204929_schedule_event_role_resolution` · `20260620210659_gate_sponsor_exhibitor_behind_llm` · `20260620211858_trust_llm_role_over_source_ceiling` · `20260620220014_organizer_brandmatch_only_and_timeout` · `20260621031958_resolve_syncs_speakers` · `20260621033836_company_bucket_trigger` · `20260621034218_icp_filter_rpcs` · `20260621034245_subscribed_contacts_filters` · `20260621034625_facets_add_industry_size` · `20260621042115_email_unlock_tier` · `20260621042220_event_filter_preview` · `20260621042813_email_unlock_default_true_until_golive` · `20260621043449_reveal_emails_returns_revealed` · **PENDING** `20260621050000_GOLIVE_email_unlock_default_false`.

All applied via Supabase MCP `apply_migration` (assigns its own timestamp; local filename reconciled to match). See [[feedback-supabase-migrations-only]].

**2026-06-28 count reconciliation + preview redesign** (see `docs/EVENT_COUNTS_AND_PREVIEW.md`): `20260627190332_browsable_events_settle_filter_1h` · `20260627190352_contacts_backfill_primary_email` · `20260627190450_contact_emails_autoprimary_first_email` · `20260627190538_event_preview_add_event_role` · `20260627190604_event_filter_preview_add_title_to_rows`. Standardized the "with email" count to "any non-empty email" across all surfaces, added a Role column to the event preview table, and rebuilt the filtered preview to mirror the main table (Title/Role/Location/Industry/Size shown, Name/Company blurred, Email locked; Attendee badge now green).

---

## 8. Go-live checklist

1. (Optional) finalize unlock cost-box copy (already says "identity 1 cr, email +1 cr").
2. Apply pending migration `20260621050000_GOLIVE_email_unlock_default_false` via MCP.
3. `git push` → Vercel (deploys all the UI). The Vercel CLI token is expired locally; deploys go via git push.
4. Smoke test: unlock a few contacts on a test account → emails should be hidden with "Reveal" buttons → reveal one → email appears, balance drops by 1.

Steps 2 and 3 must happen together.

---

## 9. Extending

- **New filter axis:** add the predicate to `event_filtered_contact_ids` (+ the My Events page CTE), a breakdown to `get_event_filter_facets`, and a control to `EventFilters`.
- **New industry value:** insert into `company_industry_bucket_map` (idempotent).
- **Re-resolve an event after new posts:** `select resolve_company_event_roles('<event_id>', true);` via MCP (nightly cron does active events automatically).
- **Audit (planned Phase 7):** `/audit-icp-tagging` skill — id parity, organizer=brand-only, evidence-supports-label, coverage %, guardrail integrity.

## 10. V1 limitations

- Role filter joins the contact's CURRENT company to `company_event_roles`; usually the same company that earned the role.
- Haiku sponsor precision ~80% on ad/creative events (vs 24% for the old regex); the qualifying-agent pass tightens new posts.
- "With email only" in My Events filters on the revealed email (locked-email contacts are excluded there).
- My Events filter-facet **dropdown counts** are still **event-wide, not owned-aware** (the Seniority dropdown shows e.g. "Director 1,412" even when you own 10). This now reads as "candidates available to unlock"; the main stats line was reworded to remove the conflation (owned-match vs unlockable are two separate numbers). A fully owned-aware dropdown count would need a second facets call scoped to `customer_contact_access` — deferred.
