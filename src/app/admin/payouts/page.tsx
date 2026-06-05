import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminAffiliate } from "@/types/admin";
import PayoutsView from "./payouts-view";

export default async function AdminPayoutsPage() {
  const admin = createAdminClient();

  const { data } = await admin
    .from("admin_affiliate_overview")
    .select("*")
    .gt("pending_balance_usd", 0)
    .order("pending_balance_usd", { ascending: false });

  return <PayoutsView affiliates={(data ?? []) as AdminAffiliate[]} />;
}
