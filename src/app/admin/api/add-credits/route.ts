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

  const { user_id, credits_to_add } = await request.json();

  if (!user_id || !credits_to_add || credits_to_add <= 0) {
    return NextResponse.json(
      { success: false, message: "user_id and positive credits_to_add are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_add_credits", {
    p_user_id: user_id,
    p_credits_to_add: credits_to_add,
  });

  if (error) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }

  // Notify the user that credits were added (best-effort, never blocks the response).
  try {
    const result = data as { new_balance?: number };
    const { data: userRes } = await admin.auth.admin.getUserById(user_id);
    const email = userRes?.user?.email;
    if (email) {
      await enqueueEmail({
        userId: user_id,
        email,
        templateKey: "credits_added",
        payload: { creditsAdded: credits_to_add, newBalance: result?.new_balance ?? null },
      });
    }
  } catch (err) {
    console.error("credits_added email enqueue failed:", err);
  }

  return NextResponse.json(data);
}
