import { createAdminClient } from "@/lib/supabase/admin";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a route param that may be either an event UUID or a slug.
 * Returns the canonical event_id, or null if not found.
 */
export async function resolveEventId(
  idOrSlug: string,
): Promise<string | null> {
  const admin = createAdminClient();

  if (UUID_RE.test(idOrSlug)) {
    const { data } = await admin
      .from("events")
      .select("id")
      .eq("id", idOrSlug)
      .maybeSingle();
    return data?.id ?? null;
  }

  const { data } = await admin
    .from("events")
    .select("id")
    .eq("slug", idOrSlug)
    .maybeSingle();
  return data?.id ?? null;
}
