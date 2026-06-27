# Event Counts Reconciliation + Preview Redesign (2026-06-28)

How the contact/email **counts** are computed across the Browse page, the event
detail page, and the ICP filter breakdown, why they used to disagree, and the
preview-table changes that shipped alongside the fix.

---

## 1. The problem (before)

For an actively-collecting event, three surfaces showed three different numbers:

| Surface | Source | Example (GITEX AI Europe) |
|---|---|---|
| Browse card | `get_all_browsable_events` (cached 1h) | 2,062 contacts / 1,274 emails |
| Event page header | `get_event_by_slug` (live) | 2,071 / 1,281 |
| Filter breakdown | `events.facets_cache` → `event_filtered_contact_ids` | 2,071 / **1,262** |

Two independent causes:

### Totals drift
`get_all_browsable_events` excluded contacts touched in the last **3 hours**
("settle" filter, a `WHERE` clause) AND the whole list is wrapped in a 1-hour
`unstable_cache` (`lib/events/get-browsable-events.ts`). So the browse total
lagged the live event-page total. The 3h filter and the 1h cache are
**independent**: the cache is the page-load optimization; the settle filter is
data-freshness only.

### Email count: three definitions, one of them wrong
- Header / browse counted **any non-empty email** (≈1,282).
- The breakdown counted `contacts.has_primary_email` (a denormalized
  `is_primary=true` flag) → **1,263**.
- We are **not meaningfully validating** emails: `contact_emails.status` was
  `valid` for 140,975 rows and `invalid` for only **5 rows in the whole DB**.
  So `status='valid'` ≈ "any email"; that distinction was a red herring.

The real gap: **14,464 contacts (~10%)** had a real, revealable email that was
never flagged `is_primary` (14,399 had a single email; 65 had two). The
email-reveal path grabs `is_primary DESC NULLS LAST LIMIT 1`, so those contacts
**do** have a deliverable email — the breakdown was hiding sellable data.

---

## 2. The fix (canonical definition: "has any non-empty email")

The honest "with email" number is **has any non-empty email**, because reveal
falls back to any email. We made every surface converge on it:

1. **`browsable_events_settle_filter_1h`** — lower the settle filter 3h → 1h in
   `get_all_browsable_events`. `WHERE`-clause only, **no page-load impact** (the
   1h cache is untouched). Browse total now tracks live within the cache window.
2. **`contacts_backfill_primary_email`** — for every contact with an email but no
   primary, mark one email primary (most recent; tie-break by id), then resync
   `contacts.has_primary_email`. After this, `any email == primary email`
   (140,749 contacts), so the breakdown matches the header.
3. **`contact_emails_autoprimary_first_email`** — `BEFORE INSERT` trigger that
   marks a contact's first email primary if they have none. Prevents the drift
   from recurring.

Verified post-fix: any / primary / `has_primary_email` flag all = **140,749**.

> Residual: the browse card can still trail the live total by up to the 1h cache
> window on actively-collecting events. This is intentional (perf) and accepted.

---

## 3. Preview-table changes (same release)

### Event detail page — main contact preview (`event-detail.tsx`)
- New **Role** column between **Title** and **LinkedIn Profile**, rendered with
  the shared `RoleBadge`. Driven by `get_event_preview` now returning
  `event_role` + `is_speaker` (migration `event_preview_add_event_role`). Role is
  the effective per-contact role (same derivation as
  `event_filtered_contact_ids`).

### Filtered preview — the pre-unlock tease (`event-filters.tsx` `FilteredPreview`)
Restructured to mirror the main contact table. Columns:
**Name · Title · Role · Company · Industry · Size · Location · Email**.
- **Shown:** Title, Role, Location, Industry, Size.
- **Blurred until unlock:** Name, Company.
- **Email:** literal "Locked" (or "—" when none).
- First match is a fully-revealed **SAMPLE** row (name + company visible); the
  rest blur identity only.
- `current_title` added to the redacted rows via
  `get_event_filter_preview` (migration
  `event_filter_preview_add_title_to_rows`) — joins `contacts` directly so the
  shared `event_filtered_contact_ids` helper is left untouched.

### Role badge styling — shared component
`src/app/dashboard/events/[id]/role-badge.tsx` (`RoleBadge`). **Attendee is now
green** (emerald) per product decision; expected_attendee stays muted;
sponsor amber / exhibitor blue / organizer purple. Used by the event preview
table, the filtered preview, and (attendee color matched) the My Events
contact table.

### My Events expanded row (`contact-table.tsx`)
- **Removed the "About Company" section** (`company_description` blurb). Company
  LinkedIn, Company Website, Founded, and **Post Content** remain.
- Attendee badge recolored to green to match the shared style.

---

## 4. Migrations (this release, 2026-06-28)

`20260627190332_browsable_events_settle_filter_1h` ·
`20260627190352_contacts_backfill_primary_email` ·
`20260627190450_contact_emails_autoprimary_first_email` ·
`20260627190538_event_preview_add_event_role` ·
`20260627190604_event_filter_preview_add_title_to_rows`

All applied via Supabase MCP `apply_migration` (assigns its own timestamp; local
filenames reconciled to match). See migrations-only rule.

---

## 4b. My Events follow-ups (2026-06-28)

### Role column moved next to Title
In the unlocked-events table (`contact-table.tsx`) the **Role** badge column now
sits immediately after **Title** (was between Company and Source), matching the
public event preview table. Pure column reorder; `TOTAL_COLS` unchanged.

### Progressive (streaming) contact load — `my-events-view.tsx`
Previously `fetchContacts` pulled the whole event in 1,000-row batches but only
called `setContacts` once at the very end, so the table stayed blank behind a
progress bar until every batch arrived (~7 round-trips for Cannes).

Now it streams: a small **first batch (50)** paints the first page in one
round-trip, then the rest loads in 1,000-row batches in the background behind a
non-blocking "Loading more contacts… N loaded" footer. Same path improves filter
changes — the old rows stay under an "Updating results…" overlay only until the
first batch of the new (server-filtered) result swaps in.

Also added **load cancellation**: a `loadTokenRef` is bumped on every event/filter
change; an in-flight loop whose token is stale bails before touching state, fixing
a latent race where overlapping loads could interleave.

Loading states:
- `loading && !initialLoadDone` → full-height loader (initial, before first batch).
- `refetching` → overlay over old rows (filter reload, before first new batch).
- `loading && initialLoadDone && !refetching` → background streaming footer.

**Trade-off (known):** the contacts RPC returns rows ordered by `charged_at DESC`
but the client re-sorts by the chosen column (default post date), so rows can
**reshuffle while the rest streams in**. Brief for typical owned sets (hundreds–
low thousands); a few seconds for Cannes-scale. Acceptable for current scale.

### Future: server-side pagination (Option B) — when to do it
If customers routinely own **>10–20k** contacts, move to true server-side
pagination + sort + search: the RPC returns exactly the current page already
sorted/filtered, the browser never holds more than one page, and the first page is
instant **and stable** at any size. Requires: sort/search/count params on
`get_subscribed_event_contacts`, reworked live counts (new/processed/with-email
via cheap count queries), CSV export fetching the full filtered set on demand, and
cross-page "select all" / bulk reveal driven by a server-side id list. Deferred as
over-engineering for current owned-set sizes.

---

## 5. Gotchas / future

- `contact_emails.status` is effectively meaningless today (everything is
  `valid`). If real validation is ever added, revisit the canonical definition —
  "with email" may want to mean "valid email" again.
- New email-ingest paths no longer need to set `is_primary` themselves; the
  `autoprimary` trigger handles the first email. Setting it explicitly still
  works and takes precedence.
- The browse list cache busts on its 1h `revalidate` or via the
  `events-browsable` tag after admin mutations.
