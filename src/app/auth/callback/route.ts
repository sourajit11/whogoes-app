import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLoopsContact, sendLoopsEvent } from "@/lib/loops";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Create contact in Loops for email automation (must await before redirect,
      // otherwise Vercel kills the serverless function before the API call completes)
      const {
        data: { user },
      } = await supabase.auth.getUser();
      let isNewUser = false;
      if (user) {
        // Flag new sign-ups so the client can fire the Google Ads conversion event
        // and so we only push genuinely-new users into the Loops onboarding flow.
        isNewUser =
          !!user.created_at &&
          Date.now() - new Date(user.created_at).getTime() < 60_000;

        if (isNewUser) {
          // Google SSO stores name as "full_name", email/password stores as "first_name"
          const meta = user.user_metadata ?? {};
          const firstName =
            meta.first_name ?? meta.full_name?.split(" ")[0] ?? "";
          const lastName =
            meta.last_name ?? meta.full_name?.split(" ").slice(1).join(" ") ?? "";

          await createLoopsContact({
            email: user.email!,
            firstName,
            lastName,
            plan: "free",
            creditsBalance: 20,
            creditsUsed: 0,
          }).catch((err) => console.error("Loops contact creation failed:", err));

          await sendLoopsEvent({
            email: user.email!,
            eventName: "signup",
          }).catch((err) => console.error("Loops signup event failed:", err));

          // Attribute this signup to an affiliate (referral cookie or email match).
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
      }

      const redirectUrl = isNewUser
        ? `${origin}${next}?new_signup=1`
        : `${origin}${next}`;

      return NextResponse.redirect(redirectUrl);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
