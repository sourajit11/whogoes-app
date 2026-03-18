import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import CustomerDetail from "./customer-detail";

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  // Get customer info
  const { data: users } = await admin.auth.admin.listUsers();
  const user = users?.users?.find((u) => u.id === id);
  if (!user) notFound();

  // Get free credits (from user_signups)
  const { data: signup } = await admin
    .from("user_signups")
    .select("free_credits")
    .eq("user_id", id)
    .single();

  // Get paid credits + totals (from customers)
  const { data: customer } = await admin
    .from("customers")
    .select("credits_balance, total_paid_amount, total_purchased_credits")
    .eq("user_id", id)
    .single();

  // Get payment history
  const { data: payments } = await admin
    .from("payments")
    .select("id, amount_usd, credits, package_name, status, created_at, paid_at")
    .eq("user_id", id)
    .order("created_at", { ascending: false });

  // Get subscribed events
  const { data: subscriptions } = await admin
    .from("customer_event_subscriptions")
    .select("event_id, subscribed_at, is_paused, events(name)")
    .eq("user_id", id)
    .order("subscribed_at", { ascending: false });

  // Get recent unlocks
  const { data: unlocks } = await admin
    .from("customer_contact_access")
    .select("contact_id, event_id, charged_at, events(name), contacts(full_name)")
    .eq("user_id", id)
    .order("charged_at", { ascending: false })
    .limit(50);

  // Get monthly usage for this user
  const { data: monthlyUsage } = await admin
    .from("customer_contact_access")
    .select("charged_at")
    .eq("user_id", id);

  // Aggregate monthly usage client-side
  const usageByMonth: Record<string, number> = {};
  monthlyUsage?.forEach((row) => {
    const month = new Date(row.charged_at).toISOString().slice(0, 7);
    usageByMonth[month] = (usageByMonth[month] ?? 0) + 1;
  });
  const monthlyBreakdown = Object.entries(usageByMonth)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, count]) => ({ month, credits_used: count }));

  return (
    <CustomerDetail
      userId={id}
      email={user.email ?? "Unknown"}
      signedUpAt={user.created_at}
      freeCredits={signup?.free_credits ?? 0}
      paidCredits={customer?.credits_balance ?? 0}
      totalPaidAmount={customer?.total_paid_amount ?? 0}
      totalPurchasedCredits={customer?.total_purchased_credits ?? 0}
      payments={
        payments?.map((p) => ({
          id: p.id,
          amount_usd: p.amount_usd,
          credits: p.credits,
          package_name: p.package_name,
          status: p.status,
          created_at: p.created_at,
          paid_at: p.paid_at,
        })) ?? []
      }
      subscriptions={
        subscriptions?.map((s) => {
          const evt = s.events as unknown as { name: string } | null;
          return {
            event_id: s.event_id,
            event_name: evt?.name ?? "Unknown",
            subscribed_at: s.subscribed_at,
            is_paused: s.is_paused,
          };
        }) ?? []
      }
      recentUnlocks={
        unlocks?.map((u) => {
          const evt = u.events as unknown as { name: string } | null;
          const contact = u.contacts as unknown as { full_name: string | null } | null;
          return {
            contact_id: u.contact_id,
            event_id: u.event_id,
            event_name: evt?.name ?? "Unknown",
            contact_name: contact?.full_name ?? null,
            contact_email: null,
            charged_at: u.charged_at,
          };
        }) ?? []
      }
      monthlyBreakdown={monthlyBreakdown}
    />
  );
}
