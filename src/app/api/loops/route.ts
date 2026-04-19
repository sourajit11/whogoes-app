import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendLoopsEvent, updateLoopsContact } from "@/lib/loops";

/** Fires a Loops event with contact properties for the authenticated user */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { eventName, eventId } = body;

  if (!eventName) {
    return NextResponse.json(
      { error: "eventName is required" },
      { status: 400 }
    );
  }

  // Fetch current credit balance (RPC returns a single integer)
  const { data: totalCredits } = await supabase.rpc("get_customer_credits");

  // For first_unlock, fetch event-specific data
  let eventData: Record<string, string | number | boolean> = {};
  if (eventName === "first_unlock" && eventId) {
    const adminSupabase = createAdminClient();

    // Get event name (bypass RLS — read-only lookup for email)
    const { data: eventInfo } = await adminSupabase
      .from("events")
      .select("event_name, event_id")
      .eq("event_id", eventId)
      .single();

    // Get total contacts for this event (bypass RLS — contacts table may restrict user reads)
    const { count: totalContacts } = await adminSupabase
      .from("contacts")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId);

    // Get how many credits user has used on this event
    const { count: creditsUsedOnEvent } = await supabase
      .from("customer_contact_access")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("event_id", eventId);

    eventData = {
      eventName: eventInfo?.event_name ?? "",
      totalContacts: totalContacts ?? 0,
      creditsUsed: creditsUsedOnEvent ?? 0,
    };

    console.log("[loops] first_unlock event data:", {
      user: user.email,
      eventId,
      eventData,
    });
  }

  // Update contact properties in Loops
  await updateLoopsContact(user.email!, {
    creditsBalance: totalCredits ?? 0,
    ...eventData,
  });

  // Send the event
  await sendLoopsEvent({
    email: user.email!,
    eventName,
    eventProperties: eventData,
  });

  return NextResponse.json({ success: true });
}
