import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { onUserSignup } from "@/lib/email/signup";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      let isNewUser = false;
      if (user) {
        // Flag new sign-ups so the client can fire the Google Ads conversion event
        // and so we only enter genuinely-new users into the onboarding email flow.
        isNewUser =
          !!user.created_at &&
          Date.now() - new Date(user.created_at).getTime() < 60_000;

        if (isNewUser) {
          // Run the internal onboarding email sequence (welcome, prospect bonus,
          // inactive nurture). Must await before redirect so Vercel doesn't kill
          // the function mid-write.
          await onUserSignup({
            id: user.id,
            email: user.email!,
            user_metadata: user.user_metadata,
          }).catch((err) => console.error("onUserSignup failed:", err));

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
