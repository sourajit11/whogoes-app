import { createAdminClient } from "@/lib/supabase/admin";
import { listAllAuthUsers } from "@/lib/supabase/list-all-users";
import PaymentsList from "./payments-list";

export default async function AdminPaymentsPage() {
  const admin = createAdminClient();

  const { data: payments } = await admin
    .from("payments")
    .select(
      "id, user_id, razorpay_order_id, razorpay_payment_id, amount_usd, currency, credits, status, package_name, created_at, paid_at"
    )
    .order("created_at", { ascending: false });

  const userMap = await listAllAuthUsers(admin);

  const paymentsWithEmail = (payments ?? []).map((p) => ({
    ...p,
    user_email: userMap.get(p.user_id)?.email ?? "Unknown",
  }));

  return <PaymentsList payments={paymentsWithEmail} />;
}
