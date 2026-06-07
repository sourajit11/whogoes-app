import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueEmail } from "./enqueue";
import { renderTemplate, type UserEmailContext } from "./templates";
import { sendEmail } from "./client";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Transactional emails bypass the suppression list and the daily cap.
const TRANSACTIONAL = new Set([
  "welcome",
  "prospect_bonus",
  "credits_added",
  "paid_immediate",
]);

const DEFAULT_CTX: UserEmailContext = {
  balance: 0,
  free_credits: 0,
  paid_credits: 0,
  is_paid: false,
  total_unlocked: 0,
  first_unlock_at: null,
  event_count: 0,
  events: [],
};

type Admin = ReturnType<typeof createAdminClient>;

interface EmailRow {
  id: string;
  user_id: string | null;
  email: string;
  template_key: string;
  attempts: number;
  scheduled_for: string;
  payload: Record<string, unknown> | null;
}

export interface ProcessResult {
  enqueued: number;
  sent: number;
  skipped: number;
  failed: number;
  deferred: number;
}

export async function processEmails(): Promise<ProcessResult> {
  const admin = createAdminClient();
  const enqueued = await runScans(admin);
  const send = await sendDue(admin);
  return { enqueued, ...send };
}

// ---------------------------------------------------------------------------
// Pass 1: scan live state and enqueue state-based emails
// ---------------------------------------------------------------------------
async function runScans(admin: Admin): Promise<number> {
  let count = 0;

  // Flow B — active sequence anchored to the user's first unlock.
  const { data: active } = await admin.rpc("email_scan_active_flow");
  for (const r of active ?? []) {
    const firstUnlock = new Date(r.first_unlock_at).getTime();
    const a = await enqueueEmail({
      userId: r.user_id,
      email: r.email,
      templateKey: "active_1h",
      scheduledFor: new Date(firstUnlock + 1 * HOUR),
      payload: {
        firstName: r.first_name,
        event_id: r.event_id,
        event_name: r.event_name,
        event_slug: r.event_slug,
      },
      dedupeKey: `${r.user_id}:active_1h`,
    });
    const b = await enqueueEmail({
      userId: r.user_id,
      email: r.email,
      templateKey: "active_day2",
      scheduledFor: new Date(firstUnlock + 48 * HOUR),
      payload: { firstName: r.first_name },
      dedupeKey: `${r.user_id}:active_day2`,
    });
    if (a) count++;
    if (b) count++;
  }

  // Flow D — pre-event reminder for free users (5 days out).
  const { data: pre } = await admin.rpc("email_scan_pre_event");
  for (const r of pre ?? []) {
    const ok = await enqueueEmail({
      userId: r.user_id,
      email: r.email,
      templateKey: "pre_event_5d",
      payload: {
        firstName: r.first_name,
        event_id: r.event_id,
        event_name: r.event_name,
        event_slug: r.event_slug,
        total_contacts: r.total_contacts,
      },
      dedupeKey: `pre_event_5d:${r.user_id}:${r.event_id}`,
    });
    if (ok) count++;
  }

  // Low-balance top-up nudge.
  const { data: low } = await admin.rpc("email_scan_low_balance");
  for (const r of low ?? []) {
    const ok = await enqueueEmail({
      userId: r.user_id,
      email: r.email,
      templateKey: "low_balance",
      payload: { firstName: r.first_name },
      dedupeKey: `${r.user_id}:low_balance`,
    });
    if (ok) count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// Pass 2: send everything that's due
// ---------------------------------------------------------------------------
async function sendDue(admin: Admin): Promise<Omit<ProcessResult, "enqueued">> {
  const now = new Date();
  const { data: due } = await admin
    .from("email_messages")
    .select("id, user_id, email, template_key, attempts, scheduled_for, payload")
    .eq("status", "pending")
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(200);

  const rows = (due ?? []) as EmailRow[];
  let sent = 0,
    skipped = 0,
    failed = 0,
    deferred = 0;
  if (rows.length === 0) return { sent, skipped, failed, deferred };

  // Suppression list.
  const { data: supp } = await admin.from("email_suppressions").select("email");
  const suppressed = new Set(
    (supp ?? []).map((s: { email: string }) => s.email.toLowerCase())
  );

  // Users who already received a capped (non-transactional) email today.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { data: sentToday } = await admin
    .from("email_messages")
    .select("user_id, template_key")
    .eq("status", "sent")
    .gte("sent_at", startOfDay.toISOString());
  const cappedToday = new Set<string>();
  for (const r of sentToday ?? []) {
    if (r.user_id && !TRANSACTIONAL.has(r.template_key)) cappedToday.add(r.user_id);
  }

  for (const row of rows) {
    const isTransactional = TRANSACTIONAL.has(row.template_key);
    const emailLc = row.email.toLowerCase();

    // Suppressed recipients get nothing but transactional mail.
    if (!isTransactional && suppressed.has(emailLc)) {
      await mark(admin, row, "skipped", "suppressed");
      skipped++;
      continue;
    }

    // Net 1 marketing email per user per day — defer the rest.
    if (!isTransactional && row.user_id && cappedToday.has(row.user_id)) {
      const next = new Date(new Date(row.scheduled_for).getTime() + DAY);
      await admin
        .from("email_messages")
        .update({ scheduled_for: next.toISOString() })
        .eq("id", row.id);
      deferred++;
      continue;
    }

    // prospect_bonus: grant the complimentary credits BEFORE sending the email
    // that announces them. The email only goes out once the grant succeeds, and
    // the creditsGranted flag makes retries idempotent (no double-granting).
    if (
      row.template_key === "prospect_bonus" &&
      row.user_id &&
      !(row.payload as Record<string, unknown> | null)?.creditsGranted
    ) {
      const amount = Number((row.payload as Record<string, unknown>)?.creditsAdded ?? 100);
      const { error: grantErr } = await admin.rpc("admin_add_credits", {
        p_user_id: row.user_id,
        p_credits_to_add: amount,
      });
      if (grantErr) {
        // Do not send until the credits are actually added — leave it to retry.
        const attempts = row.attempts + 1;
        const status = attempts >= 3 ? "failed" : "pending";
        await admin
          .from("email_messages")
          .update({ status, attempts, last_error: `credit grant failed: ${grantErr.message}` })
          .eq("id", row.id);
        if (status === "failed") failed++;
        continue;
      }
      const newPayload = { ...(row.payload ?? {}), creditsGranted: true };
      await admin.from("email_messages").update({ payload: newPayload }).eq("id", row.id);
      row.payload = newPayload;
    }

    // Live context for rendering + condition re-checks.
    let ctx: UserEmailContext = DEFAULT_CTX;
    if (row.user_id) {
      const { data } = await admin.rpc("get_user_email_context", {
        p_user_id: row.user_id,
      });
      if (data) ctx = data as UserEmailContext;
    }

    if (shouldSkip(row.template_key, ctx)) {
      await mark(admin, row, "skipped", "condition_not_met");
      skipped++;
      continue;
    }

    const payload = row.payload ?? {};
    const firstName =
      typeof payload.firstName === "string" ? payload.firstName : "";
    const rendered = renderTemplate(row.template_key, { firstName, ctx, payload });
    if (!rendered) {
      await mark(admin, row, "skipped", "unknown_template");
      skipped++;
      continue;
    }

    try {
      await sendEmail({
        to: row.email,
        subject: rendered.subject,
        text: rendered.text,
      });
      await admin
        .from("email_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          attempts: row.attempts + 1,
        })
        .eq("id", row.id);
      sent++;
      if (!isTransactional && row.user_id) cappedToday.add(row.user_id);
    } catch (err) {
      const attempts = row.attempts + 1;
      const status = attempts >= 3 ? "failed" : "pending";
      await admin
        .from("email_messages")
        .update({ status, attempts, last_error: String(err) })
        .eq("id", row.id);
      if (status === "failed") failed++;
    }
  }

  return { sent, skipped, failed, deferred };
}

// Skip a step when live state says it no longer applies.
function shouldSkip(templateKey: string, ctx: UserEmailContext): boolean {
  if (templateKey === "inactive_day1" || templateKey === "inactive_day3") {
    return ctx.total_unlocked > 0; // they've since unlocked -> Flow B takes over
  }
  if (templateKey === "pre_event_5d") {
    return ctx.is_paid; // pre-event nudge targets free users only
  }
  return false;
}

async function mark(
  admin: Admin,
  row: EmailRow,
  status: string,
  reason: string
): Promise<void> {
  await admin
    .from("email_messages")
    .update({ status, last_error: reason, attempts: row.attempts + 1 })
    .eq("id", row.id);
}
