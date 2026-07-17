"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ReferralQr from "@/app/affiliate/components/referral-qr";
import type { AffiliateRow } from "@/lib/affiliate";

interface ReferViewProps {
  affiliate: AffiliateRow | null;
  defaultName: string;
}

const usd = (n: number) => "$" + (n ?? 0).toFixed(2);

export default function ReferView({ affiliate, defaultName }: ReferViewProps) {
  // No affiliate record yet -> show the program and let them apply in-app.
  if (!affiliate) return <ApplyState defaultName={defaultName} />;
  if (affiliate.status === "pending") return <PendingState />;
  if (affiliate.status === "suspended") return <SuspendedState />;
  return <ActiveState affiliate={affiliate} />;
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-4xl px-6 py-8">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Not an affiliate yet: key points + in-app apply                     */
/* ------------------------------------------------------------------ */

function ApplyState({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function apply() {
    setError("");
    setLoading(true);
    const { error } = await supabase.rpc("affiliate_apply", {
      p_display_name: defaultName,
      p_accept_terms: true,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // Confirmation to the applicant + notification to the admin inbox.
    await fetch("/api/email/affiliate-apply", { method: "POST" }).catch(() => {});
    // Re-render the server page so it now shows the pending state.
    router.refresh();
  }

  return (
    <Page>
      {/* Hero */}
      <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6 sm:p-8 dark:border-emerald-900/50 dark:from-emerald-950/30 dark:to-zinc-950">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
          Affiliate Program
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white">
          Earn <span className="text-emerald-600 dark:text-emerald-400">30% on every purchase</span>, forever.
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          You already use WhoGoes. Refer people who need event attendee lists and
          earn 30% of every credit purchase they make. Their first pack and every
          top-up after. No cap, no expiry.
        </p>
      </div>

      {/* Why partner */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Pillar
          title="A product people need"
          body="Trade show and event attendee lists, with proof. 1,200+ events covered, credit packs from $29."
        />
        <Pillar
          title="Income that compounds"
          body="Customers buy credits again and again as they unlock more events. You earn 30% every single time."
        />
        <Pillar
          title="Simple to promote"
          body="Share your link or add prospect emails. Anyone can browse events free, so the offer sells itself."
        />
      </div>

      {/* How it works */}
      <h2 className="mt-10 text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
        How it works
      </h2>
      <ol className="mt-5 space-y-4">
        <Step n={1} title="Apply below." body="One click with this account. We review every application, usually within a day." />
        <Step n={2} title="Share your link or add prospect emails." body="Send your link to people who need attendee data, or enter emails of prospects you are working." />
        <Step n={3} title="They sign up and buy." body="Once matched, that customer is permanently yours and you earn on every purchase they ever make." />
        <Step n={4} title="You get paid." body="30% of every credit purchase, first one and every top-up. Payouts go out once your balance reaches $100." />
      </ol>

      {/* Terms quick facts */}
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Fact label="Commission" value="30% of every purchase, forever" />
        <Fact label="Repeat purchases" value="Included. You keep earning on every top-up." />
        <Fact label="Minimum payout" value="$100" />
        <Fact label="Tracking" value="Your referral link or submitted prospect emails" />
      </div>

      {/* Apply card */}
      <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
          Ready to start earning?
        </h2>
        <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          Apply with your current WhoGoes account. Once approved, your affiliate
          dashboard opens right here, with your referral link and payout tracking.
        </p>

        <label className="mt-5 flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span>
            I agree to the{" "}
            <Link
              href="/affiliate/terms"
              target="_blank"
              className="font-medium text-emerald-600 hover:underline"
            >
              Affiliate Program Terms
            </Link>
            .
          </span>
        </label>

        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <button
          onClick={apply}
          disabled={!agreed || loading}
          className="mt-5 w-full cursor-pointer rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-8"
        >
          {loading ? "Submitting..." : "Apply to become an affiliate"}
        </button>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------ */
/* Pending / suspended                                                 */
/* ------------------------------------------------------------------ */

function StatusCard({
  title,
  body,
  tone = "emerald",
}: {
  title: string;
  body: string;
  tone?: "emerald" | "amber";
}) {
  const ring =
    tone === "amber"
      ? "border-amber-200 dark:border-amber-900/50"
      : "border-emerald-200 dark:border-emerald-900/50";
  const badge =
    tone === "amber"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
  return (
    <Page>
      <div className={`mx-auto max-w-xl rounded-2xl border bg-white p-8 text-center shadow-sm dark:bg-zinc-900 ${ring}`}>
        <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-xl ${badge}`}>
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="mt-5 text-xl font-bold text-zinc-900 dark:text-white">{title}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
      </div>
    </Page>
  );
}

function PendingState() {
  return (
    <StatusCard
      title="Application under review"
      body="Thanks for applying to the WhoGoes affiliate program. We review every application personally, usually within a day. As soon as you're approved, your referral link and dashboard show up right here."
    />
  );
}

function SuspendedState() {
  return (
    <StatusCard
      tone="amber"
      title="Account suspended"
      body="Your affiliate account is currently suspended. Reach out to hello@whogoes.co if you think this is a mistake."
    />
  );
}

/* ------------------------------------------------------------------ */
/* Active affiliate: link + earnings, entry to the full portal         */
/* ------------------------------------------------------------------ */

function ActiveState({ affiliate }: { affiliate: AffiliateRow }) {
  const [copied, setCopied] = useState(false);
  const link = affiliate.referral_code
    ? `https://app.whogoes.co/events?ref=${affiliate.referral_code}`
    : "";

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (e.g. insecure context); the field is selectable.
    }
  }

  return (
    <Page>
      <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
        Refer & Earn
      </h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        You earn 30% on every credit purchase your referrals make, forever.
      </p>

      {/* Earnings */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MiniStat label="Pending balance" value={usd(affiliate.pending_balance_usd)} accent />
        <MiniStat label="Total earned" value={usd(affiliate.total_earned_usd)} />
        <MiniStat label="Paid out" value={usd(affiliate.paid_balance_usd)} />
      </div>

      {/* Referral link */}
      {link && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Your referral link
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Anyone who signs up and buys through this link is tagged to you.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            />
            <button
              onClick={copy}
              className="cursor-pointer rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <ReferralQr url={link} />
        </div>
      )}

      {/* Enter the full portal */}
      <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5 sm:flex-row sm:items-center dark:border-emerald-900/50 dark:bg-emerald-900/20">
        <div>
          <p className="font-semibold text-zinc-900 dark:text-white">
            Your affiliate dashboard
          </p>
          <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
            Add prospect emails, track referred signups, and manage payouts.
          </p>
        </div>
        <Link
          href="/affiliate"
          className="flex-none rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
        >
          Open dashboard
        </Link>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function Pillar({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
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
        <span className="font-semibold text-zinc-900 dark:text-white">{title}</span>{" "}
        {body}
      </p>
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-800/40">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-zinc-800 dark:text-zinc-200">{value}</p>
    </div>
  );
}

function MiniStat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${accent ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-900 dark:text-white"}`}>
        {value}
      </p>
    </div>
  );
}
