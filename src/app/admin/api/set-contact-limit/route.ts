import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 403 });
  }

  const { affiliate_id, limit } = await request.json();
  if (!affiliate_id || typeof limit !== "number") {
    return NextResponse.json(
      { success: false, message: "affiliate_id and numeric limit are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_set_contact_limit", {
    p_affiliate_id: affiliate_id,
    p_limit: limit,
  });

  if (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
