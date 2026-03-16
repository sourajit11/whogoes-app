import { createAdminClient } from "@/lib/supabase/admin";
import CustomerList from "./customer-list";

export default async function AdminCustomersPage() {
  const admin = createAdminClient();

  const { data: customers } = await admin
    .from("admin_customer_overview")
    .select("*")
    .order("signed_up_at", { ascending: false });

  return <CustomerList customers={customers ?? []} />;
}
