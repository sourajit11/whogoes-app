import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin toggle: add or remove an email from the suppression list.
 * Body: { email: string, action: "suppress" | "unsuppress" }
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 403 });
  }

  const { email, action } = await request.json();
  if (!email || typeof email !== "string") {
    return NextResponse.json(
      { success: false, message: "email is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const lower = email.toLowerCase();

  if (action === "unsuppress") {
    const { error } = await admin
      .from("email_suppressions")
      .delete()
      .eq("email", lower);
    if (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, suppressed: false });
  }

  const { error } = await admin
    .from("email_suppressions")
    .upsert({ email: lower, reason: "admin" }, { onConflict: "email", ignoreDuplicates: true });
  if (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, suppressed: true });
}
