import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { BROWSABLE_EVENTS_TAG } from "@/lib/events/get-browsable-events";

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 403 });
  }

  const { event_id, name, is_active } = await request.json();

  if (!event_id) {
    return NextResponse.json(
      { success: false, message: "event_id is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("events")
    .update({
      name,
      is_active,
    })
    .eq("id", event_id);

  if (error) {
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 }
    );
  }

  // Invalidate cached public /events list so edits appear immediately.
  revalidateTag(BROWSABLE_EVENTS_TAG, "max");

  return NextResponse.json({ success: true });
}
