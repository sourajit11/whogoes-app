export interface AffiliateReferral {
  id: string;
  email: string | null;
  source: "email_match" | "link";
  status: "active" | "voided";
  referred_at: string;
  first_purchase_at: string | null;
  earned_usd: number;
}

export interface AffiliateContact {
  email: string | null;
  status: "pending" | "matched" | "expired";
  added_at: string;
  matched_at: string | null;
}

export interface AffiliateCommission {
  amount_usd: number;
  commission_usd: number;
  status: "pending" | "paid" | "voided";
  created_at: string;
}

export interface AffiliatePayout {
  amount_usd: number;
  status: "pending" | "paid";
  method: string | null;
  reference: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface AffiliateDashboard {
  status: "none" | "pending" | "active" | "suspended";
  referral_code: string | null;
  display_name: string | null;
  payout_method: string | null;
  payout_details: Record<string, unknown> | null;
  pending_balance_usd: number;
  paid_balance_usd: number;
  total_earned_usd: number;
  payout_threshold_usd: number;
  signups: number;
  paying_customers: number;
  referrals: AffiliateReferral[];
  contacts: AffiliateContact[];
  commissions: AffiliateCommission[];
  payouts: AffiliatePayout[];
}
