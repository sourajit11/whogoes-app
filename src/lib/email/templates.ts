// Plain-text email templates. Voice: Souraa from WhoGoes, casual, no em dashes,
// no corporate filler. Every body ends with the STOP unsubscribe PS.

const APP_URL = "https://app.whogoes.co";
const DASHBOARD_URL = `${APP_URL}/dashboard`;
const PRICING_URL = `${APP_URL}/dashboard/billing`;
const eventUrl = (slug: string) => `${APP_URL}/events/${slug}`;

const PS =
  'PS: Don\'t want any automated emails from WhoGoes? Reply "STOP" and I\'ll remove you from our list.';

export interface EventCtx {
  event_id: string;
  name: string;
  slug: string;
  start_date: string | null;
  days_until: number | null;
  total_contacts: number;
  unlocked_count: number;
}

export interface UserEmailContext {
  balance: number;
  free_credits: number;
  paid_credits: number;
  is_paid: boolean;
  total_unlocked: number;
  first_unlock_at: string | null;
  event_count: number;
  events: EventCtx[];
}

export interface RenderInput {
  firstName: string;
  ctx: UserEmailContext;
  payload: Record<string, unknown>;
}

export interface RenderedEmail {
  subject: string;
  text: string;
}

const remaining = (e: EventCtx) =>
  Math.max(0, (e.total_contacts ?? 0) - (e.unlocked_count ?? 0));

const greeting = (firstName: string) =>
  firstName ? `Hi ${firstName},` : "Hi there,";

const sign = (body: string) => `${body}\n\nSouraa\nWhoGoes\n\n${PS}`;

/**
 * Render a plain-text email for a template key. Returns null when the template
 * is unknown so the caller can mark the row skipped.
 */
export function renderTemplate(
  templateKey: string,
  input: RenderInput
): RenderedEmail | null {
  const { firstName, ctx, payload } = input;
  const hi = greeting(firstName);

  switch (templateKey) {
    case "welcome":
      // First email: no links, no images.
      return {
        subject: "You're in. Here's how WhoGoes works",
        text: sign(
          `${hi}

Thanks for signing up to WhoGoes. You've got 20 free credits to start.

Quick version: we build trade show and event attendee lists, with proof. Pick an event and we show you who's actually going, pulled from real LinkedIn activity, with their title and company. One credit unlocks one verified contact.

To get going, head to your dashboard, open any event, and unlock your first few contacts. That's it.

If you tell me which event you're targeting, I'll point you to the right list.`
        ),
      };

    case "prospect_bonus": {
      const eventName = String(payload.eventName ?? "");
      const slug = String(payload.eventSlug ?? "");
      const added = Number(payload.creditsAdded ?? 100);
      const link = slug ? `\n\nHere's that attendee list:\n${eventUrl(slug)}` : "";
      return {
        subject: "Added 100 credits to your account",
        text: sign(
          `${hi}

Saw you signed up, so I dropped ${added} complimentary credits into your account on top of the 20 you already had. Balance is ${ctx.balance}.

I see that you're currently interested in ${eventName}.${link}

If you're after a different event, just reply and tell me which one. Happy to help you find it.`
        ),
      };
    }

    case "credits_added": {
      const added = Number(payload.creditsAdded ?? 0);
      return {
        subject: `We added ${added} credits to your account`,
        text: sign(
          `${hi}

Just added ${added} credits to your WhoGoes account. Your balance is now ${ctx.balance}.

Put them to work here: ${DASHBOARD_URL}

Reply if you want a hand picking the right event to pull from.`
        ),
      };
    }

    case "inactive_day1":
      return {
        subject: "Your first attendee list is two clicks away",
        text: sign(
          `${hi}

You've still got ${ctx.balance} free credits sitting in your WhoGoes account.

Here's the quickest way to use them: open the dashboard, pick an event you care about, and unlock a handful of contacts. Each one comes with the LinkedIn post that proves they're going.

Start here: ${DASHBOARD_URL}

Tell me the event you're chasing and I'll point you straight to it.`
        ),
      };

    case "inactive_day3":
      return {
        subject: "What's actually inside a WhoGoes list",
        text: sign(
          `${hi}

Quick look at what you get: real people who posted about going to an event, with their name, title, company, and the post itself as proof. No guessing, no scraped junk lists.

Your ${ctx.balance} free credits are still here. One credit, one verified attendee.

Browse events and unlock a few: ${DASHBOARD_URL}

Want me to suggest events for your space? Just reply with what you sell.`
        ),
      };

    case "active_1h": {
      const targetId = String(payload.event_id ?? "");
      const e =
        ctx.events.find((ev) => ev.event_id === targetId) ?? ctx.events[0];
      const eventName = e?.name ?? String(payload.event_name ?? "the event");
      const slug = e?.slug ?? String(payload.event_slug ?? "");
      const unlocked = e?.unlocked_count ?? 0;
      const rem = e ? remaining(e) : 0;
      const link = slug
        ? `\n\nIf you want to grab the rest, here's the event again:\n${eventUrl(slug)}`
        : "";
      return {
        subject: `Nice, your ${eventName} contacts are ready`,
        text: sign(
          `${hi}

You just unlocked ${unlocked} contacts from ${eventName}. There are still ${rem} more attendees you can pull from that event.

You've got ${ctx.balance} credits left.${link}

Need more credits? Pricing is here: ${PRICING_URL}

Good time to start reaching out to the ones you've unlocked. Reply if you want a hand with the outreach angle.`
        ),
      };
    }

    case "active_day2": {
      const events = ctx.events.filter((e) => e.unlocked_count > 0);
      if (events.length <= 1) {
        const e = events[0] ?? ctx.events[0];
        if (!e) return null;
        const rem = remaining(e);
        const far = (e.days_until ?? 0) > 15;
        const timing = far
          ? `\n\nFrom what we've seen, most attendees start posting closer to the event, so now is a good time to begin reaching out with the contacts you've unlocked and keep going right up to the start day.`
          : "";
        const link = e.slug
          ? `\n\nGrab more here: ${eventUrl(e.slug)}`
          : "";
        return {
          subject: `Your ${e.name} list, two days in`,
          text: sign(
            `${hi}

Quick check in on ${e.name}. You've unlocked ${e.unlocked_count} contacts and there are ${rem} more still available. Balance is ${ctx.balance} credits.${timing}${link}

Reply if you'd like help prioritizing who to message first.`
          ),
        };
      }

      // Multiple events
      const lines = events
        .map(
          (e) =>
            `- ${e.name}: ${e.unlocked_count} unlocked, ${remaining(e)} still available`
        )
        .join("\n");
      const soonest = [...events]
        .filter((e) => e.start_date)
        .sort((a, b) => (a.start_date! < b.start_date! ? -1 : 1))[0];
      const tip = soonest
        ? `\n\n${soonest.name} is the soonest one coming up, so I'd start your outreach there.`
        : "";
      return {
        subject: "Where your unlocked lists stand",
        text: sign(
          `${hi}

You've pulled contacts from a few events so far:

${lines}

You've got ${ctx.balance} credits left.${tip}

Reply if you want a hand planning the outreach across these.`
        ),
      };
    }

    case "paid_immediate":
      return {
        subject: "Thanks for the purchase, credits are in",
        text: sign(
          `${hi}

Your payment went through and the credits are in your account. Balance is now ${ctx.balance}.

Best way to use them: pick the events closest to their start date and unlock the attendees there first, since those folks are posting right now.

Jump in: ${DASHBOARD_URL}

Reply any time if you want help getting the most out of these.`
        ),
      };

    case "paid_day2": {
      const soonest = [...ctx.events]
        .filter((e) => e.start_date)
        .sort((a, b) => (a.start_date! < b.start_date! ? -1 : 1))[0];
      const tip = soonest
        ? `${soonest.name} is the soonest event you're on, so that's where I'd focus next.`
        : `Pick the event closest to its start date and unlock attendees there first.`;
      return {
        subject: "Getting the most from your credits",
        text: sign(
          `${hi}

Hope the first pulls are going well. One tip: prioritize by event date. ${tip}

You've got ${ctx.balance} credits left. Dashboard: ${DASHBOARD_URL}

Happy to suggest which events fit your space if you tell me what you sell.`
        ),
      };
    }

    case "paid_day4":
      return {
        subject: "How's the outreach going?",
        text: sign(
          `${hi}

Just checking in. How are the lists working out for you?

You've got ${ctx.balance} credits left. If you're not sure which events to pull next, reply with your target market and I'll point you to a few good ones.`
        ),
      };

    case "pre_event_5d": {
      const targetId = String(payload.event_id ?? "");
      const e =
        ctx.events.find((ev) => ev.event_id === targetId) ?? null;
      const eventName = e?.name ?? String(payload.event_name ?? "your event");
      const slug = e?.slug ?? String(payload.event_slug ?? "");
      const total = e?.total_contacts ?? Number(payload.total_contacts ?? 0);
      const unlocked = e?.unlocked_count ?? 0;
      const link = slug ? `\n\nUnlock them here: ${eventUrl(slug)}` : "";
      return {
        subject: `${eventName} is 5 days out`,
        text: sign(
          `${hi}

${eventName} kicks off in about 5 days. We've got ${total} attendees on WhoGoes for it, and you've unlocked ${unlocked} so far. Your balance is ${ctx.balance} credits.

This is the window when attendees are most active, so it's a good time to grab the rest and start reaching out.${link}

Need more credits? Options are here: ${PRICING_URL}`
        ),
      };
    }

    case "low_balance":
      return {
        subject: "You're running low on credits",
        text: sign(
          `${hi}

You're down to ${ctx.balance} credits on WhoGoes. If you've got more attendees to reach, now's a good time to top up so you don't lose momentum.

Top up here: ${PRICING_URL}

Reply if you want help picking the right pack for how many contacts you need.`
        ),
      };

    case "affiliate_application_received":
      return {
        subject: "Got your affiliate application",
        text: sign(
          `${hi}

Thanks for applying to the WhoGoes affiliate program. Your application is in and I review every one personally, usually within a day.

Once you're approved, you'll get your personal referral link plus access to your affiliate dashboard, where you can add leads and track your signups and commissions. You earn 30% on every payment your referrals make.

If you want to tell me anything about how you plan to promote WhoGoes, just reply to this email. It helps me approve faster.`
        ),
      };

    case "event_request": {
      const eventName = String(payload.eventName ?? "");
      const requesterEmail = String(payload.requesterEmail ?? "");
      const note = String(payload.note ?? "");
      return {
        subject: `Event request: ${eventName}`,
        text: `Someone requested an event on WhoGoes.

Event: ${eventName}
Requested by: ${requesterEmail || "(not signed in)"}
Note: ${note || "(none)"}

Add it here: ${APP_URL}/admin/events`,
      };
    }

    case "affiliate_new_application": {
      const applicantEmail = String(payload.applicantEmail ?? "");
      const applicantName = String(payload.applicantName ?? "");
      return {
        subject: `New affiliate application: ${applicantEmail}`,
        text: `New affiliate application on WhoGoes.

Email: ${applicantEmail}
Name: ${applicantName || "(not provided)"}

Review and approve here: ${APP_URL}/admin/affiliates`,
      };
    }

    case "affiliate_approved": {
      const referralCode = String(payload.referralCode ?? "");
      return {
        subject: "You're approved. Here's your referral link",
        text: sign(
          `${hi}

Good news, your WhoGoes affiliate application is approved.

Here's your personal referral link:
${APP_URL}/events?ref=${referralCode}

Anyone who signs up through that link (or any lead email you add in your dashboard) is tagged to you, and you earn 30% of every payment they make.

Your dashboard is here: ${APP_URL}/affiliate

Two ways to get your first commission:
1. Share your link with people who need event attendee lists.
2. Add lead emails in your dashboard. If any of them sign up within 30 days, they count as yours.

Reply if you have any questions. Happy to help you get the first one over the line.`
        ),
      };
    }

    default:
      return null;
  }
}
