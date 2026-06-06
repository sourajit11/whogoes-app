import { NextRequest, NextResponse } from "next/server";
import { processEmails } from "@/lib/email/process";

// Give the queue room to send a batch within a single invocation.
export const maxDuration = 60;

/**
 * Runs the email queue: scans for state-based sends, then mails everything due.
 * Called by the n8n schedule workflow. Protected by ?secret=EMAIL_CRON_SECRET.
 */
async function handle(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  if (!process.env.EMAIL_CRON_SECRET || secret !== process.env.EMAIL_CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processEmails();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("processEmails failed:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
