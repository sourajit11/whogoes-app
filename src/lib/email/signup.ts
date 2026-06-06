import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueEmail } from "./enqueue";

const DAY = 24 * 60 * 60 * 1000;

interface SignupUser {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown> | null;
}

/**
 * Runs the post-signup email sequence:
 *  1. Welcome (immediate, no links).
 *  2. If the signup email matches a scraped prospect, grant 100 bonus credits
 *     once and send the prospect_bonus email.
 *  3. Schedule the inactive nurture (Day 1 + Day 3), skipped at send time if the
 *     user has unlocked anything by then.
 *
 * Safe to call more than once per user — every step is dedupe-keyed.
 */
export async function onUserSignup(user: SignupUser): Promise<void> {
  const email = user.email;
  const meta = user.user_metadata ?? {};
  const fullName =
    typeof meta.full_name === "string" ? meta.full_name : "";
  const firstName =
    (typeof meta.first_name === "string" && meta.first_name) ||
    fullName.split(" ")[0] ||
    "";

  // 1. Welcome
  await enqueueEmail({
    userId: user.id,
    email,
    templateKey: "welcome",
    payload: { firstName },
    dedupeKey: `${user.id}:welcome`,
  });

  // 2. Prospect match -> bonus credits + custom email
  try {
    const admin = createAdminClient();
    const { data: match } = await admin.rpc("find_prospect_event_for_email", {
      p_email: email,
    });
    if (match?.matched) {
      const inserted = await enqueueEmail({
        userId: user.id,
        email,
        templateKey: "prospect_bonus",
        payload: {
          firstName,
          eventName: match.event_name,
          eventSlug: match.event_slug,
          creditsAdded: 100,
        },
        dedupeKey: `${user.id}:prospect_bonus`,
      });
      // Only grant credits when this is the first time we enqueued the bonus.
      if (inserted) {
        await admin.rpc("admin_add_credits", {
          p_user_id: user.id,
          p_credits_to_add: 100,
        });
      }
    }
  } catch (err) {
    console.error("Prospect bonus failed:", err);
  }

  // 3. Inactive nurture
  await enqueueEmail({
    userId: user.id,
    email,
    templateKey: "inactive_day1",
    scheduledFor: new Date(Date.now() + 1 * DAY),
    payload: { firstName },
    dedupeKey: `${user.id}:inactive_day1`,
  });
  await enqueueEmail({
    userId: user.id,
    email,
    templateKey: "inactive_day3",
    scheduledFor: new Date(Date.now() + 3 * DAY),
    payload: { firstName },
    dedupeKey: `${user.id}:inactive_day3`,
  });
}
