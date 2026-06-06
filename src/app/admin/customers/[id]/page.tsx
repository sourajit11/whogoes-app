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

  // Get customer info (gates the page — must resolve before the rest)
  const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(id);
  if (userErr || !userRes?.user) notFound();
  const user = userRes.user;

  // Everything below is keyed only on the user id and independent of each
  // other — fetch in parallel instead of seven sequential round-trips.
  const [
    { data: signup },
    { data: customer },
    { data: payments },
    { data: subscriptions },
    { data: unlocks },
    { count: totalUnlocks },
    { data: monthlyUsage },
    { data: refRow },
    { data: suppression },
  ] = await Promise.all([
    admin
      .from("user_signups")
      .select("free_credits")
      .eq("user_id", id)
      .single(),
    admin
      .from("customers")
      .select("credits_balance, total_paid_amount, total_purchased_credits")
      .eq("user_id", id)
      .single(),
    admin
      .from("payments")
      .select("id, amount_usd, credits, package_name, status, created_at, paid_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false }),
    admin
      .from("customer_event_subscriptions")
      .select("event_id, subscribed_at, is_paused, events(name)")
      .eq("user_id", id)
      .order("subscribed_at", { ascending: false }),
    admin
      .from("customer_contact_access")
      .select("contact_id, event_id, charged_at, events(name), contacts(full_name)")
      .eq("user_id", id)
      .order("charged_at", { ascending: false })
      .limit(50),
    admin
      .from("customer_contact_access")
      .select("contact_id", { count: "exact", head: true })
      .eq("user_id", id),
    admin
      .from("customer_contact_access")
      .select("charged_at")
      .eq("user_id", id),
    admin
      .from("admin_customer_overview")
      .select("referred_by_email, referred_by_code, referral_source")
      .eq("user_id", id)
      .maybeSingle(),
    admin
      .from("email_suppressions")
      .select("email")
      .eq("email", (user.email ?? "").toLowerCase())
      .maybeSingle(),
  ]);

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
      contactsUnlockedCount={totalUnlocks ?? 0}
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
      referredByEmail={refRow?.referred_by_email ?? null}
      referredByCode={refRow?.referred_by_code ?? null}
      referralSource={refRow?.referral_source ?? null}
      initialSuppressed={!!suppression}
    />
  );
}
