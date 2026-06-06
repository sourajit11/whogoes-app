import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Adds an email to the suppression list. Called by the n8n Gmail workflow when a
 * recipient replies "STOP". Protected by ?secret=EMAIL_CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (!process.env.EMAIL_CRON_SECRET || secret !== process.env.EMAIL_CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { email } = await request.json().catch(() => ({ email: null }));
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("email_suppressions")
    .upsert(
      { email: email.toLowerCase(), reason: "stop_reply" },
      { onConflict: "email", ignoreDuplicates: true }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
