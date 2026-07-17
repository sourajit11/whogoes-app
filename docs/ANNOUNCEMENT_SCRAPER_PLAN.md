# Organizer Announcement Coverage: Plan, Test, Rollback

Status: DRAFT for review. No infra change until this is approved and the dry-run passes.
Owner: Souraa. Author: investigation 2026-07-08 (n8n exec 52279, event CDAO Washington DC `755ba87e-904a-434d-9435-79e668570c58`).

## 1. The problem, restated with proof

An organizer / host-company LinkedIn page posts a SERIES of announcements about one event, each post naming a DIFFERENT speaker or attendee. We keep only one and throw the rest away.

Verified on the live database:

- Event `CDAO Washington DC` was scraped by the ad-hoc workflow (exec 52279). Apify returned 7 posts from the same author (Corinium Global Intelligence), each announcing a different speaker.
- Only ONE `posts` row exists for that author+event: status `qualified`, `third_party_confirmation`, `mentioned_profiles = [Richa Varshney]`.
- The other 6 posts (6 more speakers) were never stored.

Two compounding failures cause this:

1. Ingestion dedup. `insert_post_if_new` + a unique index on `posts(author_linkedin_url, event_id)` enforce one post row per author per event. Posts 2..7 return "duplicate" and are dropped. Correct for a normal attendee, wrong for an organizer announcing many people.
2. Mention overwrite. The scraper node `Update Post Mention Profiles` PATCHes `posts.mentioned_profiles = <this item's mentions>` on the shared surviving row, so items clobber each other. (Independent bug; must be fixed in the new path regardless.)

## 2. What is NOT the problem (verified)

The qualifier does NOT disqualify these posts. Proof: the surviving Corinium post is `qualified`. Each individual announcement post ("X will be speaking at CDAO DC") passes the Phase 2 genre filter (single-focus company update, not editorial) and the per-name evidence gate, and produces `mentioned_names = [{name, evidence}]`. So once the posts are allowed to land, the existing qualifier handles them correctly with no change.

One nuance to preserve, not fix: a SINGLE post that lists many names with no per-person phrase (a tag dump) is intentionally stripped by the BULK TAG-BLOCK GUARD. That is correct precision behavior. Our case is many posts each with ONE justified name, which is the opposite and passes cleanly.

## 3. Decision (locked with Souraa)

- V1: a SEPARATE scraper workflow that scrapes only the organizer page for each event. We accept paying twice to scrape the same post. V2 will unify.
- Drop the "individual employee of the host company" case for V1 (needs employer resolution, too complex).
- Land announcement posts in the EXISTING `posts` table (not a separate table) so they inherit the entire downstream (Phase 2 qualify, mention enrichment, role resolver, contact facts, pricing, facets) for free. A separate table would force us to rebuild all of that.
- Do NOT touch the live RPC `insert_post_if_new`. Add a NEW sibling RPC instead.

## 4. How each concern is handled

### 4a. How the posts get qualified
Reuse the existing Phase 2 qualifier (`qLTalNnfJ8fOqhcg`). It claims posts via `claim_posts_for_qualification`, which selects `status = 'in_process'` on non-adhoc events, regardless of which workflow created the post. Announcement posts inserted with `status = 'in_process'` and a non-null `posted_at` on a non-adhoc event are picked up automatically. No qualifier change.

### 4b. How mentioned individuals are extracted safely
Reuse the existing mention path. The qualifier's company branch matches AI-confirmed `mentioned_names` (with a >= 4 char evidence phrase) against the post's `mentioned_profiles` to attach LinkedIn URLs, writes `post_mentions` rows, and Phase 5 (`claim_mentions_for_enrichment` -> enrichment) turns them into `contacts` + `contact_events (source_type = 'mentioned')`. Safety (evidence gate + bulk-tag guard) is already built. Our only jobs: (a) stop losing the posts, (b) write `mentioned_profiles` correctly per post (fix the overwrite bug) so the URL match works.

### 4c. How exhibiting / sponsoring COMPANIES are captured safely  (PHASE 3, separate, higher risk)
This is NOT solved by 4a/4b and must be its own phase. Today:
- The qualifier's `event_role` describes only the AUTHOR'S OWN company, not a tagged third-party company.
- The role resolver (`_resolve_event_roles_calc`) and the real-time `tag_contact_event_role` both apply a source ceiling: a `mention` caps at rank 1 (attendee). So a tagged exhibiting company can never become "exhibitor" automatically.

To auto-tag a tagged company X as exhibitor when a credible author says "X is exhibiting", Phase 3 needs all of:
1. Qualifier emits per-mentioned-COMPANY role claims with evidence (new output field), plus the tagged company's LinkedIn URL.
2. Storage for company mentions + claimed role (extend `post_mentions` or a new `post_company_mentions`).
3. A NEW claim path into `company_event_roles` that bypasses the mention ceiling ONLY when the author is the organizer / a verified company page (credibility gate), writing role = exhibitor/sponsor for company X.
4. Existing `refresh_event_contact_facts` then flips X's contacts. (Reused, no change.)

Because this writes to `company_event_roles`, which drives customer-facing facets and 2-tier pricing, it is higher risk and ships only after Phase 1+2 is proven, with its own audit (`/audit-icp-tagging`, `/audit-role-qualification`).

## 5. Schema changes (minimal, additive, reversible)  [REVISED after reading the live RPC]

Reading the live `insert_post_if_new` shrank this. The RPC dedups with two explicit checks, each backed by a real index:
- Check 1 `duplicate_url`: skips if `post_url` exists anywhere. Backed by `posts_post_url_key` = `UNIQUE(post_url)` GLOBAL.
- Check 2 `duplicate_author_event`: skips if same author+event exists. Backed by `idx_posts_author_event_unique` = `UNIQUE(author_linkedin_url, event_id) WHERE author_linkedin_url IS NOT NULL`.

Two consequences:
- post_url is ALREADY globally unique, so re-scrape idempotency is already handled. We do NOT add any `(event_id, post_url)` index (dropped from the earlier draft). It also means a given post can never be stored twice, so there is no cross-scraper duplicate risk between the main scraper and the announcement scraper.
- The ONLY thing dropping our announcement posts is Check 2 + `idx_posts_author_event_unique`. So the whole change is: let announcement rows escape Check 2.

Changes (live RPC untouched):

1. Additive column:
   `ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_announcement boolean NOT NULL DEFAULT false;`
   Every existing row defaults false and behaves exactly as today.

2. Relax the author/event dedup so ONLY announcement rows escape it. Zero-gap ordering (never leave the table without author/event uniqueness for normal posts):
   - Step 1: create the replacement partial unique FIRST, alongside the old one:
     `CREATE UNIQUE INDEX CONCURRENTLY idx_posts_author_event_notann ON posts(author_linkedin_url, event_id) WHERE author_linkedin_url IS NOT NULL AND NOT is_announcement;`
   - Step 2: only after it is valid, `DROP INDEX idx_posts_author_event_unique;`
   (`posts_post_url_key` stays as-is and keeps global idempotency.)

3. New sibling ingestion RPC `insert_announcement_post(...)` = a copy of `insert_post_if_new` with Check 2 REMOVED and `is_announcement = true` set on insert. It keeps Check 1 (respects the global post_url unique). Faithful and tiny; the live RPC is not modified. (author_type is not set by the current RPC either, so we match that; author_type is derived downstream.)

4. New column to drive the scraper:
   `ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer_linkedin_url text;`
   Explicit scrape target per event. Chosen over `organizer_company_id` because that field is null for most events (confirmed null for CDAO DC). Populated by us / `suggest-organizers.mjs`.

Operational note on CONCURRENTLY: the master scraper runs HOURLY, so there is no natural quiet window. Therefore part 2 is applied as: `CREATE UNIQUE INDEX CONCURRENTLY` (zero write-block) via execute_sql, verify `indisvalid`, then `DROP INDEX idx_posts_author_event_unique` (millisecond ACCESS EXCLUSIVE), then record a `supabase_migrations.schema_migrations` row (version `20260708120100`, name `swap_posts_author_event_partial_index`) so local file and remote stay in sync. CONCURRENTLY cannot run inside a migration transaction, which is why it goes through execute_sql rather than apply_migration.

Verified pre-flight (already run read-only, all green): `(event_id, post_url)` duplicate groups = 0; `is_announcement` and `events.organizer_linkedin_url` do not exist yet.

## 6. New scraper workflow (separate, starts INACTIVE)  [BUILT]

BUILT: `Phase 1b: Organizer Announcement Scraper (INACTIVE)`, workflow id `85szSLn4QouseOoZ`, inactive, validated (0 errors / 0 warnings).

Design decision: no profile-posts Apify actor exists in the account (both live scrapers use the keyword-search actor `harvestapi/linkedin-post-search`, `buIWk2uOUzTmcLsuB`). Rather than guess a new actor, the workflow REUSES that proven keyword-search actor and adds an organizer-author filter. This reproduces exactly how exec 52279 surfaced the 7 Corinium posts.

Flow: Manual trigger -> Get events (Supabase getAll) -> keep only those with `organizer_linkedin_url` set -> expand keywords -> loop per event (batchSize 1) -> keyword search (single page, `postedLimit=month`) -> `Prep & Filter` code node (computes the post's author company URL + extracts `mentioned_profiles` from contentAttributes) -> `Is Organizer Post` filter (author URL == event `organizer_linkedin_url`) -> `insert_announcement_post` -> only if newly inserted, PATCH that row's `mentioned_profiles`.

Key properties:
- The `mentioned_profiles` OVERWRITE BUG disappears for free: each announcement post now gets its own row id (no author+event dedup), so the per-row PATCH cannot clobber siblings.
- Loop control advances from `Has Results?` independently of the organizer filter, so a page with zero organizer posts cannot stall the loop.
- v1 limitation (accepted): single search page per event, no pagination. Organizer announcements for one upcoming event rarely exceed one page; revisit if a dry-run shows truncation.
- Everything after ingestion is the existing pipeline. Nothing else in n8n changes.

## 7. Test plan (must pass before go-live)

Test target = CDAO Washington DC (`755ba87e...`), which already demonstrates the loss (1 of 7 speakers).

Adhoc wrinkle (discovered during verification): CDAO DC is the ONLY adhoc event in the DB (1 of 728), and `claim_posts_for_qualification` excludes adhoc events, so the scheduled qualifier would NOT pick up new announcement posts on it. To run the full scrape -> qualify -> enrich path end to end on the test event, we set CDAO DC `is_adhoc = false` for the test (it is a real conference; this is a product decision because non-adhoc events become browsable/sellable). Alternative if we do not want CDAO public: pick a real non-adhoc event that has a known organizer page and point the scraper there instead. DECISION REQUIRED before the dry-run.

Pre-flight (read-only): DONE. `is_announcement` absent; `organizer_linkedin_url` absent; `(event_id, post_url)` dup groups = 0; CDAO baseline = 1 post, 0 post_mentions, 0 contacts, 0 speakers.

Apply schema (section 5, items 1, 2, 4) additively, set `events.organizer_linkedin_url` for the test event to the Corinium page, keep the new scraper INACTIVE, and run it once manually against ONLY the test event.

Test cases and expected results:
- T1 Coverage: after the run, CDAO DC has 7 announcement `posts` rows (was 1), each `is_announcement = true`, distinct `post_url`, correct per-row `mentioned_profiles`.
- T2 Qualification: the qualifier processes all 7 (status flips to qualified/done), each qualified post yields `post_mentions` for its one speaker.
- T3 Enrichment: after Phase 5, `contact_events` for CDAO DC grows by ~6 new speaker contacts vs the P4 baseline; no duplicate contact for Richa.
- T4 No regression on normal ingestion: pick a normal (non-announcement) event, re-run the MAIN scraper, confirm it still stores exactly one row per author per event (the partial unique still enforces the old rule for `is_announcement = false`).
- T5 Idempotency: re-run the announcement scraper on CDAO DC. Expect zero new rows (deduped on `(event_id, post_url)`), no duplicate `post_mentions`, no duplicate contacts.
- T6 Overwrite bug fixed: each of the 7 rows keeps its OWN `mentioned_profiles`; none is empty or carrying another post's names.

Go-live only if T1..T6 all pass.

## 8. Post-change health + regression audit (requested)

After the dry-run and before/while flipping the scraper on more broadly, audit that nothing else regressed:

Database:
- A1 Row-count deltas: `posts`, `post_mentions`, `contact_events`, `company_event_roles` before vs after (expect growth only on the test event; no unexpected spikes).
- A2 Constraint integrity: the two new partial unique indexes are `valid`; the old full unique is gone; no `posts` row violates the new author/event partial rule (dupes among `is_announcement = false`).
- A3 Role sanity: no company flipped to sponsor/exhibitor from a mention (ceiling still holds); `company_event_roles` for the test event unchanged in shape except attendee additions.
- A4 Event counts: `events.facets_cache` and the "with email" counts for the test event refresh correctly and are not double-counted.

Workflows (n8n):
- A5 Phase 2 qualifier `qLTalNnfJ8fOqhcg` and its twin `8Ade8PNYYf060x8H`: recent executions still succeed; queue drains; no new error class from announcement posts.
- A6 Phase 5 enrichment: claim RPC still hands disjoint batches; no runaway from the added mentions.
- A7 Role resolver crons (`resolve-dirty-event-roles`, realtime): still green.
- A8 Main daily scraper `gW0KbGiWfr0ZsTgI`: unaffected (it uses the untouched `insert_post_if_new`); confirm its next run's new-post count is normal.
- A9 Run existing audit skills: `/audit-role-qualification`, `/audit-icp-tagging`, `/audit-mention-qualification`, and check for new anomalies.

## 9. Rollback

- Fastest: deactivate the new scraper (one toggle). No further ingestion of announcements.
- Data: `DELETE FROM posts WHERE is_announcement = true;` (cascades to their post_mentions; contacts already enriched are harmless and can stay).
- Schema down: recreate the original full unique `idx_posts_author_event_unique`, drop the two partial indexes, drop `posts.is_announcement`, drop `events.organizer_linkedin_url`. Provide as a paired down-migration.

## 10. Open dependency before implementation

Need the current definitions to write a faithful migration:
```sql
SELECT pg_get_functiondef('public.insert_post_if_new'::regprocedure);
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'posts';
```
