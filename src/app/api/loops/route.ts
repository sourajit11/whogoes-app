import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendLoopsEvent, updateLoopsContact } from "@/lib/loops";

/**
 * Refreshes Loops contact properties for the authenticated user.
 * If `eventName` is provided, also fires that event to Loops.
 * If `eventId` is provided, includes event-specific properties (eventName, totalContacts, creditsUsed).
 */
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

  // Fresh credit balance
  const { data: totalCredits } = await supabase.rpc("get_customer_credits");

  // Total credits used across all events (used by paid-user emails)
  const { count: creditsUsedTotalCount } = await supabase
    .from("customer_contact_access")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  // Event-specific data (used by free-user first_unlock emails)
  let eventData: Record<string, string | number | boolean> = {};
  if (eventId) {
    const adminSupabase = createAdminClient();

    // Get event name (bypass RLS — read-only lookup for email)
    const { data: eventInfo } = await adminSupabase
      .from("events")
      .select("event_name, event_id")
      .eq("event_id", eventId)
      .single();

    // Get total contacts for this event (bypass RLS — contacts table restricts user reads)
    const { count: totalContacts } = await adminSupabase
      .from("contacts")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId);

    // Credits user has spent on this specific event
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
  }

  console.log("[loops] contact refresh:", {
    user: user.email,
    eventId,
    eventName,
    creditsUsedTotal: creditsUsedTotalCount,
    eventData,
  });

  // Always refresh contact properties with fresh numbers
  await updateLoopsContact(user.email!, {
    creditsBalance: totalCredits ?? 0,
    creditsUsedTotal: creditsUsedTotalCount ?? 0,
    ...eventData,
  });

  // Only fire a Loops event when an eventName is provided (e.g., first_unlock)
  if (eventName) {
    await sendLoopsEvent({
      email: user.email!,
      eventName,
      eventProperties: eventData,
    });
  }

  return NextResponse.json({ success: true });
}
