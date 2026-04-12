import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
      if (user) {
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

        // Send signup event to trigger the onboarding loop
        await sendLoopsEvent({
          email: user.email!,
          eventName: "signup",
        }).catch((err) => console.error("Loops signup event failed:", err));
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
