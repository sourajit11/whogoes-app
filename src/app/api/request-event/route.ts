import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enqueueEmail } from "@/lib/email/enqueue";

const ADMIN_INBOX = "hello@whogoes.co";
const MAX_NAME = 200;
const MAX_NOTE = 500;

// The public Browse page is served both on the app and proxied under the apex
// marketing domain (whogoes.co/events). A submission from the apex is a
// cross-origin call to this route, so it needs CORS headers to succeed.
const ALLOWED_ORIGINS = new Set([
  "https://whogoes.co",
  "https://www.whogoes.co",
  "https://app.whogoes.co",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
  }
  return {};
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

/**
 * "Request an event" from Browse Events. Emails the request to the admin inbox
 * so we can add the event to the pipeline. The requester is resolved from the
 * session cookie, so signed-in users don't need to retype their email.
 */
export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body: { eventName?: string; note?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request" },
      { status: 400, headers: cors }
    );
  }

  const eventName = (body.eventName ?? "").trim().slice(0, MAX_NAME);
  const note = (body.note ?? "").trim().slice(0, MAX_NOTE);
  // Signed-in users are identified by their session; signed-out users must
  // supply an email so we know who to follow up with.
  const requesterEmail = (user?.email ?? body.email ?? "").trim().slice(0, MAX_NAME);

  if (!eventName) {
    return NextResponse.json(
      { success: false, error: "Event name is required" },
      { status: 400, headers: cors }
    );
  }

  if (!requesterEmail || !requesterEmail.includes("@")) {
    return NextResponse.json(
      { success: false, error: "A valid email is required" },
      { status: 400, headers: cors }
    );
  }

  await enqueueEmail({
    userId: null,
    email: ADMIN_INBOX,
    templateKey: "event_request",
    payload: { eventName, note, requesterEmail },
  });

  return NextResponse.json({ success: true }, { headers: cors });
}
