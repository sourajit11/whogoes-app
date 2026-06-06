import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { onUserSignup } from "@/lib/email/signup";

/**
 * Post-signup hook for email/password registrations (public route — the user is
 * resolved from the session cookie, not the request body). Runs the onboarding
 * email sequence and attributes the signup to an affiliate.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email) {
    // Only genuinely new accounts enter the onboarding sequence.
    const isNewUser =
      !!user.created_at &&
      Date.now() - new Date(user.created_at).getTime() < 120_000;

    if (isNewUser) {
      await onUserSignup({
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata,
      });
    }

    // Attribute the signup to an affiliate (referral cookie or email match).
    try {
      const refCode = (await cookies()).get("wg_ref")?.value ?? null;
      await createAdminClient().rpc("match_affiliate_for_signup", {
        p_user_id: user.id,
        p_email: user.email,
        p_referral_code: refCode,
      });
    } catch (err) {
      console.error("Affiliate match failed:", err);
    }
  }

  return NextResponse.json({ success: true });
}
