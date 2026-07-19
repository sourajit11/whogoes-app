// GET /api/v1/events/{idOrSlug}/filter
//
// Canonical name for the live filter-counts endpoint since 2026-07-19; the
// docs only mention /filter. /facets is the original path and keeps working
// as a silent alias for anything built against the launch-day docs.
export { GET } from "../facets/route";
