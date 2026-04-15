import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthUserLite = {
  id: string;
  email: string | null;
  created_at: string;
};

export async function listAllAuthUsers(
  admin: SupabaseClient
): Promise<Map<string, AuthUserLite>> {
  const perPage = 1000;
  const map = new Map<string, AuthUserLite>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    for (const u of users) {
      map.set(u.id, {
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
      });
    }
    if (users.length < perPage) break;
  }
  return map;
}
