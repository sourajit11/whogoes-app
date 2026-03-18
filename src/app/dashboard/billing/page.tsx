import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import BillingContent from "./billing-content";

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: payments } = await supabase.rpc("get_payment_history");
  const { data: usage } = await supabase.rpc("get_usage_history");

  return (
    <BillingContent
      payments={payments ?? []}
      usage={usage ?? []}
      userEmail={user.email ?? ""}
    />
  );
}
