"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

const DISMISS_KEY = "wg-affiliate-promo-dismissed";

/**
 * Overview promo inviting existing customers into the affiliate program. Once
 * dismissed it stays hidden (localStorage), so it nudges without nagging.
 */
export default function AffiliatePromoCard() {
  // Start hidden so the card never flashes before we've read the dismiss flag.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) !== "1") setVisible(true);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="relative mt-8 overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 sm:p-6 dark:border-emerald-900/50 dark:from-emerald-950/30 dark:to-zinc-950">
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 cursor-pointer rounded-lg p-1 text-emerald-600/60 transition-colors hover:text-emerald-700 dark:text-emerald-400/50 dark:hover:text-emerald-400"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl pr-6">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
            Affiliate Program
          </p>
          <h3 className="mt-1.5 text-lg font-bold text-zinc-900 dark:text-white">
            Earn 30% every time someone you refer buys credits.
          </h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            You already use WhoGoes to find who&apos;s attending. Share it and earn
            30% of every credit purchase your referrals make, for life. No cap, no
            expiry.
          </p>
        </div>
        <Link
          href="/dashboard/refer"
          className="flex-none rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
        >
          Become an affiliate
        </Link>
      </div>
    </div>
  );
}
