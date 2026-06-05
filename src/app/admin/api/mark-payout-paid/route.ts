import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 403 });
  }

  const { affiliate_id, method, reference } = await request.json();
  if (!affiliate_id) {
    return NextResponse.json({ success: false, message: "affiliate_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_mark_payout_paid", {
    p_affiliate_id: affiliate_id,
    p_method: method ?? "",
    p_reference: reference ?? "",
  });

  if (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
