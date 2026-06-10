import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "WhoGoes Affiliate Program: Earn 30% on Every Sale, Forever",
  description:
    "Refer people to WhoGoes and earn 30% on every credit purchase they make, forever. No subscriptions, no cap. Apply to become an affiliate.",
  openGraph: {
    title: "WhoGoes Affiliate Program: Earn 30% on Every Sale, Forever",
    description:
      "Earn 30% on every credit purchase your referrals make, forever. Apply to become a WhoGoes affiliate.",
    url: "https://app.whogoes.co/affiliates",
  },
  alternates: {
    canonical: "https://app.whogoes.co/affiliates",
  },
};

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="font-semibold text-zinc-900 dark:text-white">{title}</h3>
      <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        {n}
      </span>
      <p className="text-zinc-600 dark:text-zinc-400">
        <span className="font-semibold text-zinc-900 dark:text-white">
          {title}
        </span>{" "}
        {body}
      </p>
    </li>
  );
}

function TermRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-zinc-200 py-3 sm:flex-row sm:gap-6 dark:border-zinc-800">
      <dt className="w-full font-medium text-zinc-900 sm:w-52 sm:flex-none dark:text-white">
        {label}
      </dt>
      <dd className="text-zinc-600 dark:text-zinc-400">{value}</dd>
    </div>
  );
}

export default function AffiliatesPage() {
  return (
    <div className="bg-white dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-emerald-600 text-lg font-bold text-white">
              W
            </span>
            <span className="text-lg font-semibold text-zinc-500 dark:text-zinc-400">
              WhoGoes
            </span>
          </Link>
          <div className="flex items-center gap-5">
            <Link
              href="/affiliate/login"
              className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            >
              Affiliate login
            </Link>
            <Link
              href="/affiliate/register"
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              Become an affiliate
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-br from-emerald-50 via-white to-emerald-50 dark:from-emerald-950/20 dark:via-zinc-950 dark:to-emerald-950/20">
        <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
          <p className="text-sm font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
            Affiliate Program
          </p>
          <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-zinc-900 sm:text-5xl dark:text-white">
            Earn <span className="text-emerald-600">30% on every purchase</span>,
            forever.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
            Refer people to WhoGoes and earn 30% of what they pay us. Their first
            credit purchase and every top-up they ever buy after. No expiry, no
            cap.
          </p>
          <Link
            href="/affiliate/register"
            className="mt-8 inline-block rounded-full bg-emerald-600 px-7 py-3 font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            Become an affiliate
          </Link>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-6 py-16">
        {/* Commission band */}
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-emerald-600 p-8 text-white sm:flex-row sm:gap-8">
          <div className="text-6xl font-extrabold leading-none">
            30<span className="align-super text-2xl">%</span>
          </div>
          <div>
            <p className="text-lg font-bold">
              30% on every purchase, no expiry
            </p>
            <p className="mt-1 text-emerald-50">
              WhoGoes runs on credits, not subscriptions. You earn 30% on your
              referral&apos;s first credit purchase and on every top-up they buy
              after that, for life. We do not cap it or cut it off after a year.
            </p>
          </div>
        </div>

        {/* Why partner */}
        <section className="mt-16">
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Why partner with WhoGoes
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Pillar
              title="A product people actually need"
              body="Trade show and event attendee lists, with proof. 1,200+ events covered, credit packs from $29."
            />
            <Pillar
              title="Income that compounds"
              body="Customers buy credits again and again as they unlock more events. You earn 30% every single time."
            />
            <Pillar
              title="Simple to promote"
              body="Share your link or submit prospect emails. Anyone can browse events free, so the offer sells itself."
            />
          </div>
        </section>

        {/* Two ways to get credited */}
        <section className="mt-16">
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Two ways to get credited
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Pillar
              title="1. Your affiliate link"
              body="Share your unique link. Anyone who signs up and buys through it is tracked to you automatically."
            />
            <Pillar
              title="2. Submit prospect emails"
              body="Add the emails of people you think will sign up. If that email registers within 30 days before or after you add it, the customer is credited to you permanently."
            />
          </div>
        </section>

        {/* How it works */}
        <section className="mt-16">
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            How it works
          </h2>
          <ol className="mt-6 space-y-5">
            <Step
              n={1}
              title="Apply below."
              body="Tell us how you'll promote WhoGoes and we set up your affiliate link and dashboard."
            />
            <Step
              n={2}
              title="Share your link or add prospect emails."
              body="Send your link to people who need event attendee data, or enter the emails of prospects you are working."
            />
            <Step
              n={3}
              title="They sign up and buy."
              body="A submitted email counts if it registers within 30 days before or after the day you added it. Once matched, that customer is permanently credited to you and you earn on every purchase they ever make."
            />
            <Step
              n={4}
              title="You get paid."
              body="Earn 30% of every credit purchase they make, the first one and every top-up after. Payouts go out once your balance reaches $100."
            />
          </ol>
        </section>

        {/* Terms */}
        <section className="mt-16">
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Program terms
          </h2>
          <dl className="mt-6 border-t border-zinc-200 dark:border-zinc-800">
            <TermRow
              label="Commission rate"
              value="30% of every purchase made by a referred customer"
            />
            <TermRow
              label="First purchase"
              value="Included. You earn on their first credit pack."
            />
            <TermRow
              label="Repeat purchases"
              value="Included. You keep earning 30% on every top-up they ever buy, forever."
            />
            <TermRow
              label="Billing model"
              value="One-time credit purchases. No subscriptions, so no renewals to track."
            />
            <TermRow
              label="Tracking"
              value="Unique affiliate link (cookie-based), or submitted prospect emails."
            />
            <TermRow
              label="Email attribution"
              value="A submitted email is credited to you if it signs up within 30 days before or after the day you add it. One customer can only ever be credited to one affiliate."
            />
            <TermRow
              label="Minimum payout"
              value="$100. Payouts are released once your balance reaches this."
            />
            <TermRow
              label="Eligible packs"
              value="All WhoGoes credit packs ($29 / $79 / $149)."
            />
          </dl>
        </section>

        {/* Apply CTA */}
        <section id="apply" className="mt-16 scroll-mt-8">
          <div className="mx-auto max-w-xl rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">
              Ready to start earning?
            </h2>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              Create your affiliate account in under a minute. Once approved, you&apos;ll
              get your referral link and dashboard to track every signup and payout.
            </p>
            <Link
              href="/affiliate/register"
              className="mt-6 inline-block rounded-full bg-emerald-600 px-7 py-3 font-semibold text-white transition-colors hover:bg-emerald-700"
            >
              Apply to become an affiliate
            </Link>
            <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
              Already an affiliate?{" "}
              <Link href="/affiliate/login" className="font-medium text-emerald-600 hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </section>
      </div>

      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-6 py-6 text-sm text-zinc-500 sm:flex-row dark:text-zinc-400">
          <span>WhoGoes &middot; Trade Show &amp; Event Attendee Lists. With Proof.</span>
          <span>whogoes.co</span>
        </div>
      </footer>
    </div>
  );
}
