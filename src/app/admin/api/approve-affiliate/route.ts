import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueEmail } from "@/lib/email/enqueue";

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 403 });
  }

  const { affiliate_id } = await request.json();
  if (!affiliate_id) {
    return NextResponse.json({ success: false, message: "affiliate_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_approve_affiliate", {
    p_affiliate_id: affiliate_id,
  });

  if (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }

  // Tell the affiliate they're in, with their referral link.
  if (data?.success && data.referral_code) {
    try {
      const { data: aff } = await admin
        .from("affiliates")
        .select("user_id, display_name")
        .eq("id", affiliate_id)
        .single();
      if (aff?.user_id) {
        const { data: userRes } = await admin.auth.admin.getUserById(aff.user_id);
        const user = userRes?.user;
        if (user?.email) {
          const meta = user.user_metadata ?? {};
          const firstName =
            (typeof meta.first_name === "string" && meta.first_name) ||
            (aff.display_name ?? "").split(" ")[0] ||
            "";
          await enqueueEmail({
            userId: aff.user_id,
            email: user.email,
            templateKey: "affiliate_approved",
            payload: { firstName, referralCode: data.referral_code },
            dedupeKey: `${affiliate_id}:affiliate_approved`,
          });
        }
      }
    } catch (err) {
      console.error("affiliate_approved email failed:", err);
    }
  }

  return NextResponse.json(data);
}
