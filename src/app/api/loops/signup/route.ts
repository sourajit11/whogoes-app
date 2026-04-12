import { NextResponse } from "next/server";
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

  return NextResponse.json({ success: true });
}
