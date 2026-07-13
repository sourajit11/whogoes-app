import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueEmail } from "@/lib/email/enqueue";

const ADMIN_INBOX = "hello@whogoes.co";

/**
 * Post-apply hook for affiliate applications (public route — the user is
 * resolved from the session cookie). Confirms the application to the applicant,
 * notifies the admin inbox, and pulls the user out of the customer onboarding
 * sequence, which doesn't apply to affiliates.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ success: false }, { status: 401 });
  }

  const admin = createAdminClient();

  // Only fire for users who actually have an affiliate application on file.
  const { data: affiliate } = await admin
    .from("affiliates")
    .select("id, display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!affiliate) {
    return NextResponse.json({ success: false }, { status: 404 });
  }

  const meta = user.user_metadata ?? {};
  const fullName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    affiliate.display_name ||
    "";
  const firstName =
    (typeof meta.first_name === "string" && meta.first_name) ||
    fullName.split(" ")[0] ||
    "";

  await enqueueEmail({
    userId: user.id,
    email: user.email,
    templateKey: "affiliate_application_received",
    payload: { firstName },
    dedupeKey: `${user.id}:affiliate_application_received`,
  });

  await enqueueEmail({
    userId: null,
    email: ADMIN_INBOX,
    templateKey: "affiliate_new_application",
    payload: { applicantEmail: user.email, applicantName: fullName },
    dedupeKey: `${user.id}:affiliate_new_application`,
  });

  // Affiliates aren't customers: cancel any still-pending onboarding/nurture
  // emails so they don't get "unlock your first contacts" nudges.
  await admin
    .from("email_messages")
    .update({ status: "skipped", last_error: "affiliate_signup" })
    .eq("user_id", user.id)
    .eq("status", "pending")
    .in("template_key", ["welcome", "inactive_day1", "inactive_day3"]);

  return NextResponse.json({ success: true });
}
