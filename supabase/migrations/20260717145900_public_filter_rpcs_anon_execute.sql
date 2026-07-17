-- Restore public (logged-out) filtering on /events/[slug].
--
-- The July 15 hardening (20260715065407) blanket-revoked EXECUTE from anon on
-- every security-definer function, then re-granted get_event_filter_facets and
-- get_event_filter_preview to `authenticated` only. That broke live filtering and
-- the teaser preview for logged-out visitors on the public event page (they got
-- 401 permission denied and the UI silently kept stale counts / no preview).
--
-- Both functions are read-only and return non-sensitive data by design: aggregate
-- facet counts, and a preview with exactly one sample contact plus redacted rows
-- (identity/email blurred) -- the same tease already rendered on the public page.
-- event_filtered_contact_ids (the shared helper they call) is already anon-exec.
GRANT EXECUTE ON FUNCTION public.get_event_filter_facets(uuid, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.get_event_filter_preview(uuid, jsonb, integer) TO anon;
