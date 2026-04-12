import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createLoopsContact } from "@/lib/loops";

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
        await createLoopsContact({
          email: user.email!,
          firstName: user.user_metadata?.first_name ?? "",
          lastName: user.user_metadata?.last_name ?? "",
          plan: "free",
          creditsBalance: 20,
          creditsUsed: 0,
        }).catch((err) => console.error("Loops contact creation failed:", err));
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
