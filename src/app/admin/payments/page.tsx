import { createAdminClient } from "@/lib/supabase/admin";
import PaymentsList from "./payments-list";

export default async function AdminPaymentsPage() {
  const admin = createAdminClient();

  const { data: payments } = await admin
    .from("payments")
    .select(
      "id, user_id, razorpay_order_id, razorpay_payment_id, amount_usd, currency, credits, status, package_name, created_at, paid_at"
    )
    .order("created_at", { ascending: false });

  // Resolve user emails
  const { data: usersData } = await admin.auth.admin.listUsers();
  const emailMap = new Map<string, string>();
  usersData?.users?.forEach((u) => {
    emailMap.set(u.id, u.email ?? "Unknown");
  });

  const paymentsWithEmail = (payments ?? []).map((p) => ({
    ...p,
    user_email: emailMap.get(p.user_id) ?? "Unknown",
  }));

  return <PaymentsList payments={paymentsWithEmail} />;
}
