import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLoopsContact, sendLoopsEvent } from "@/lib/loops";

export async function POST(request: Request) {
  const { email, firstName, lastName } = await request.json();

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  await createLoopsContact({
    email,
    firstName: firstName ?? "",
    lastName: lastName ?? "",
    plan: "free",
    creditsBalance: 20,
    creditsUsed: 0,
  });

  // Send signup event to trigger the onboarding loop
  await sendLoopsEvent({
    email,
    eventName: "signup",
  });

  // Attribute the email/password signup to an affiliate. The session cookie is
  // set by this point, so we resolve the user id server-side rather than trust
  // the request body. Referral link is read from the wg_ref cookie.
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.email) {
      const refCode = (await cookies()).get("wg_ref")?.value ?? null;
      await createAdminClient().rpc("match_affiliate_for_signup", {
        p_user_id: user.id,
        p_email: user.email,
        p_referral_code: refCode,
      });
    }
  } catch (err) {
    console.error("Affiliate match failed:", err);
  }

  return NextResponse.json({ success: true });
}
