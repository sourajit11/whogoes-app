import { createAdminClient } from "@/lib/supabase/admin";
import DataQualityView from "./data-quality-view";

export default async function AdminDataQualityPage() {
  const admin = createAdminClient();

  const { data: quality } = await admin
    .from("admin_data_quality")
    .select("*")
    .order("total_contacts", { ascending: false });

  return <DataQualityView data={quality ?? []} />;
}
