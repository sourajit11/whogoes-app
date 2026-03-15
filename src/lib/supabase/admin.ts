import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Admin client using service_role key — bypasses RLS entirely.
// ONLY use in server-side admin code. Never import in client components.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
