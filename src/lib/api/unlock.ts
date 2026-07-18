import { createAdminClient } from "@/lib/supabase/admin";
import type { Filters } from "./filters";

/**
 * Server-side chunked unlock runner.
 *
 * The dashboard unlocks in 1,000-row batches from the browser to stay under
 * statement_timeout, threading batch_id between calls. API callers make one
 * HTTP request, so this runner does the same loop server-side: chunks of up to
 * 1,000 through api_unlock_event_contacts, threading the batch_id from the
 * first chunk and stopping on fulfillment, exhaustion, budget, or the soft
 * deadline (Vercel function limit).
 */

const CHUNK_SIZE = 1000;
export const MAX_COUNT_PER_REQUEST = 10000;
const SOFT_DEADLINE_MS = 55_000;

export interface UnlockRunOptions {
  userId: string;
  eventId: string;
  count: number;
  filters: Filters;
  includeEmails: boolean;
  /** Remaining daily spend allowance for this key, in credits. null = uncapped. */
  maxCredits: number | null;
}

export interface UnlockRunResult {
  success: boolean;
  message: string;
  contacts_unlocked: number;
  emails_included: number;
  emails_revealed: number;
  credits_spent: number;
  new_balance: number | null;
  batch_id: string | null;
  no_icp: boolean | null;
  has_more: boolean;
}

interface UnlockRpcResult {
  success: boolean;
  message?: string;
  contacts_unlocked?: number;
  emails_included?: number;
  emails_revealed?: number;
  credits_spent?: number;
  new_balance?: number;
  batch_id?: string;
  no_icp?: boolean;
  has_more?: boolean;
  current_balance?: number;
}

export async function runChunkedUnlock(
  opts: UnlockRunOptions,
): Promise<UnlockRunResult | { rpcError: string }> {
  const admin = createAdminClient();
  const startedAt = Date.now();

  const totals: UnlockRunResult = {
    success: false,
    message: "",
    contacts_unlocked: 0,
    emails_included: 0,
    emails_revealed: 0,
    credits_spent: 0,
    new_balance: null,
    batch_id: null,
    no_icp: null,
    has_more: false,
  };

  let remainingCount = Math.min(opts.count, MAX_COUNT_PER_REQUEST);
  let remainingCredits = opts.maxCredits;

  while (remainingCount > 0) {
    const chunk = Math.min(remainingCount, CHUNK_SIZE);
    const { data, error } = await admin.rpc("api_unlock_event_contacts", {
      p_user_id: opts.userId,
      p_event_id: opts.eventId,
      p_count: chunk,
      p_filters: opts.filters,
      p_include_emails: opts.includeEmails,
      p_max_credits: remainingCredits,
      p_batch_id: totals.batch_id,
    });

    if (error) {
      // If earlier chunks already charged, report what happened rather than
      // pretending the whole request failed.
      if (totals.contacts_unlocked > 0) {
        totals.success = true;
        totals.message = `${totals.contacts_unlocked} contacts unlocked (stopped early: internal error)`;
        totals.has_more = true;
        return totals;
      }
      return { rpcError: error.message };
    }

    const result = data as UnlockRpcResult;

    if (!result.success) {
      if (totals.contacts_unlocked === 0) {
        // First chunk failed: surface the RPC's own failure untouched.
        totals.message = result.message ?? "Unlock failed";
        totals.new_balance = result.new_balance ?? result.current_balance ?? null;
        totals.has_more = result.has_more ?? false;
        return totals;
      }
      // Later chunk ran dry (no more contacts / budget): finish normally.
      totals.has_more = result.has_more ?? false;
      break;
    }

    totals.success = true;
    totals.contacts_unlocked += result.contacts_unlocked ?? 0;
    totals.emails_included += result.emails_included ?? 0;
    totals.emails_revealed += result.emails_revealed ?? 0;
    totals.credits_spent += result.credits_spent ?? 0;
    totals.new_balance = result.new_balance ?? totals.new_balance;
    totals.batch_id = result.batch_id ?? totals.batch_id;
    totals.no_icp = result.no_icp ?? totals.no_icp;
    totals.has_more = result.has_more ?? false;

    remainingCount -= result.contacts_unlocked ?? 0;
    if (remainingCredits !== null) {
      remainingCredits = Math.max(0, remainingCredits - (result.credits_spent ?? 0));
      if (remainingCredits === 0 && remainingCount > 0) break;
    }
    if (!totals.has_more) break;
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) break;
  }

  if (totals.success) {
    totals.message = `${totals.contacts_unlocked} contacts unlocked`;
  }
  return totals;
}
