import { createAdminClient } from "@/lib/supabase/admin";

export interface EnqueueParams {
  userId: string | null;
  email: string;
  templateKey: string;
  scheduledFor?: Date;
  payload?: Record<string, unknown>;
  /** When set, the row is unique by this key — re-enqueues are no-ops. */
  dedupeKey?: string;
}

/**
 * Insert an email into the queue. Returns true only when a new row was actually
 * created (false on a dedupe conflict), so callers can tie one-time side effects
 * (like granting bonus credits) to a successful first enqueue.
 */
export async function enqueueEmail(params: EnqueueParams): Promise<boolean> {
  const admin = createAdminClient();
  const row = {
    user_id: params.userId,
    email: params.email.toLowerCase(),
    template_key: params.templateKey,
    scheduled_for: (params.scheduledFor ?? new Date()).toISOString(),
    payload: params.payload ?? {},
    dedupe_key: params.dedupeKey ?? null,
  };

  if (params.dedupeKey) {
    const { data, error } = await admin
      .from("email_messages")
      .upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.error("enqueueEmail error:", error);
      return false;
    }
    return (data?.length ?? 0) > 0;
  }

  const { error } = await admin.from("email_messages").insert(row);
  if (error) {
    console.error("enqueueEmail error:", error);
    return false;
  }
  return true;
}
