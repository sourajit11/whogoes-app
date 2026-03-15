import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  // Verify the caller is an admin
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 403 });
  }

  const { user_id, new_balance } = await request.json();

  if (!user_id || new_balance == null) {
    return NextResponse.json(
      { success: false, message: "user_id and new_balance are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_adjust_credits", {
    p_user_id: user_id,
    p_new_balance: new_balance,
  });

  if (error) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}
