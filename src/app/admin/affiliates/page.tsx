import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminAffiliate } from "@/types/admin";
import AffiliateList from "./affiliate-list";

export default async function AdminAffiliatesPage() {
  const admin = createAdminClient();

  const { data } = await admin
    .from("admin_affiliate_overview")
    .select("*")
    .order("created_at", { ascending: false });

  return <AffiliateList affiliates={(data ?? []) as AdminAffiliate[]} />;
}
