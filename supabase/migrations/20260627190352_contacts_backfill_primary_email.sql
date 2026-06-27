-- Reconcile the "with email" count across surfaces. The event-page header and browse card
-- count "any non-empty email" (~140,749 contacts) but the ICP filter breakdown counts
-- contacts.has_primary_email (is_primary=true, ~126,285), so it under-reported email
-- coverage by ~10% (14,464 contacts had a real, revealable email that was never flagged
-- is_primary). The reveal path falls back to any email, so those contacts DO have a usable
-- email -- the breakdown was simply hiding sellable data.
--
-- Fix the data: for every contact that has an email but no primary, mark exactly one email
-- primary (the most recently created; tie-break by id). 14,399 of these have a single email;
-- 65 have two. Then resync the denormalized contacts.has_primary_email flag the breakdown
-- reads. After this, "any email" == "primary email" so all surfaces converge.
WITH needs_primary AS (
  SELECT ce.contact_id
  FROM contact_emails ce
  WHERE ce.email IS NOT NULL AND ce.email <> ''
  GROUP BY ce.contact_id
  HAVING bool_or(ce.is_primary AND ce.email IS NOT NULL AND ce.email <> '') = false
),
pick AS (
  SELECT DISTINCT ON (ce.contact_id) ce.id
  FROM contact_emails ce
  JOIN needs_primary np ON np.contact_id = ce.contact_id
  WHERE ce.email IS NOT NULL AND ce.email <> ''
  ORDER BY ce.contact_id, ce.created_at DESC NULLS LAST, ce.id
)
UPDATE contact_emails ce
SET is_primary = true
FROM pick
WHERE ce.id = pick.id;

-- Resync the denormalized flag for any contact whose primary status just changed
-- (the AFTER trigger maintains it going forward, but a bulk UPDATE ... FROM is safest
-- to re-derive explicitly).
UPDATE public.contacts c
SET has_primary_email = EXISTS (
  SELECT 1 FROM contact_emails em
  WHERE em.contact_id = c.id AND em.is_primary
    AND em.email IS NOT NULL AND em.email <> ''
)
WHERE c.has_primary_email IS DISTINCT FROM EXISTS (
  SELECT 1 FROM contact_emails em
  WHERE em.contact_id = c.id AND em.is_primary
    AND em.email IS NOT NULL AND em.email <> ''
);
