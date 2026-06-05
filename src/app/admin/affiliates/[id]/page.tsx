import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import type { AdminAffiliateDetail } from "@/types/admin";
import AffiliateDetail from "./affiliate-detail";

export default async function AdminAffiliateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin.rpc("admin_get_affiliate_detail", {
    p_affiliate_id: id,
  });

  if (error || !data || (data as { error?: string }).error) {
    notFound();
  }

  return <AffiliateDetail affiliateId={id} detail={data as AdminAffiliateDetail} />;
}
