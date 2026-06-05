import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export interface AffiliateRow {
  id: string;
  user_id: string;
  status: "pending" | "active" | "suspended";
  referral_code: string | null;
  display_name: string | null;
  payout_method: string | null;
  payout_details: Record<string, unknown> | null;
  pending_balance_usd: number;
  paid_balance_usd: number;
  total_earned_usd: number;
  approved_at: string | null;
  created_at: string;
}

// Returns the affiliate row for the current user, or null if they have none.
// RLS scopes the read to the caller's own row.
export async function getAffiliate(): Promise<AffiliateRow | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("affiliates")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  return (data as AffiliateRow) ?? null;
}

// Affiliate's public referral link. Points at the public Browse Events page so
// the wg_ref cookie is set on the app domain before the visitor signs up.
export function referralLink(code: string): string {
  return `https://app.whogoes.co/events?ref=${code}`;
}
