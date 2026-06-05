import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Affiliate Program Terms & Conditions | WhoGoes",
  description:
    "Terms and conditions for the WhoGoes Affiliate Program, operated by AVRPIX Solutions Private Limited.",
  alternates: { canonical: "https://app.whogoes.co/affiliate/terms" },
};

function Clause({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
        {n}. {title}
      </h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {children}
      </div>
    </section>
  );
}

export default function AffiliateTermsPage() {
  return (
    <div className="bg-white dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/affiliates" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-emerald-600 text-lg font-bold text-white">
              W
            </span>
            <span className="text-lg font-semibold text-zinc-500 dark:text-zinc-400">WhoGoes</span>
          </Link>
          <Link
            href="/affiliate/register"
            className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            Become an affiliate
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
          Affiliate Program
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white">
          Terms &amp; Conditions
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Last updated: 5 June 2026 (version 2026-06)</p>

        <p className="mt-6 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          These terms govern your participation in the WhoGoes Affiliate Program (&quot;Program&quot;), operated by{" "}
          <span className="font-medium text-zinc-900 dark:text-white">AVRPIX SOLUTIONS PRIVATE LIMITED</span>{" "}
          (&quot;WhoGoes&quot;, &quot;we&quot;, &quot;us&quot;), S No 635/1A, Plot No-20, Vaibhav Society, Bibvewadi,
          Pune City, Pune 411037, Maharashtra, India (GSTIN 27ABBCA4226B1Z9). By joining the Program you
          (&quot;Affiliate&quot;, &quot;you&quot;) agree to these terms.
        </p>

        <Clause n={1} title="Enrollment">
          <p>
            You apply through our affiliate portal. Participation is not active until WhoGoes approves your
            application. We may accept or decline any application at our discretion. You must provide accurate
            information and be at least 18 years old.
          </p>
        </Clause>

        <Clause n={2} title="How you earn">
          <p>
            Once approved you receive a unique referral link and may also submit prospect email addresses. You earn a
            commission of <span className="font-medium text-zinc-900 dark:text-white">30% of the net amount</span>{" "}
            (after refunds, chargebacks, and payment-processing fees) of{" "}
            <span className="font-medium text-zinc-900 dark:text-white">every credit purchase</span> made by customers
            attributed to you, on their first purchase and every purchase thereafter, for as long as they remain a
            paying WhoGoes customer.
          </p>
        </Clause>

        <Clause n={3} title="Attribution">
          <p>
            (a) <span className="font-medium text-zinc-900 dark:text-white">Referral link</span> — a visitor who
            arrives via your link is tracked by a cookie for 90 days; if they create a WhoGoes account in that window,
            they are attributed to you.
          </p>
          <p>
            (b) <span className="font-medium text-zinc-900 dark:text-white">Submitted emails</span> — if an email you
            submit registers a WhoGoes account within 7 days before or after the day you submit it, that customer is
            attributed to you.
          </p>
          <p>
            (c) A customer can be attributed to only one affiliate (first attribution wins). You may not be credited
            for your own account or accounts you control.
          </p>
        </Clause>

        <Clause n={4} title="Contact submissions & acceptable use">
          <p>
            You may submit up to <span className="font-medium text-zinc-900 dark:text-white">10 email addresses per
            day</span> (we may adjust this limit for your account). You confirm you have a legitimate basis to contact
            the people you refer and will not spam, buy lists, or submit addresses without a genuine relationship.
            Unmatched submitted contacts expire after 30 days. We process referred emails solely to attribute
            referrals, in line with applicable data-protection law (including the Digital Personal Data Protection Act,
            2023).
          </p>
        </Clause>

        <Clause n={5} title="Prohibited conduct">
          <p>
            No self-referrals; no fraudulent, fake, or incentivized signups; no misleading claims about WhoGoes; no
            bidding on WhoGoes trademarks in paid search; no cookie stuffing, spam, or other deceptive practices.
            Violations void affected commissions and may result in termination.
          </p>
        </Clause>

        <Clause n={6} title="Payouts">
          <p>
            Commissions accrue as a pending balance. Once your pending balance reaches the{" "}
            <span className="font-medium text-zinc-900 dark:text-white">minimum payout threshold of USD 100</span> and
            you have provided valid payout details, payment is made on the{" "}
            <span className="font-medium text-zinc-900 dark:text-white">last working day of the calendar month</span>.
            Balances below the threshold roll over to the following month. Payouts are made via the method you provide
            (e.g. PayPal, Wise, or bank transfer).
          </p>
        </Clause>

        <Clause n={7} title="Taxes">
          <p>
            You are responsible for all taxes on your earnings. Payments may be subject to deduction of tax at source
            (TDS) under the Income-tax Act, 1961 (including section 194H, where applicable). You agree to provide your
            PAN and any other information we reasonably require for tax compliance. If you are GST-registered, you are
            responsible for your own GST obligations.
          </p>
        </Clause>

        <Clause n={8} title="Clawback">
          <p>
            Commissions tied to purchases that are later refunded, reversed, charged back, or found to be fraudulent
            will be voided and deducted from your balance.
          </p>
        </Clause>

        <Clause n={9} title="Relationship">
          <p>
            You are an independent contractor, not an employee, agent, or partner of WhoGoes. You have no authority to
            bind WhoGoes or make representations on its behalf.
          </p>
        </Clause>

        <Clause n={10} title="Term, suspension & termination">
          <p>
            Either party may end participation at any time. We may suspend or terminate your account and withhold
            commissions if we reasonably suspect a breach or fraud. Pending legitimately-earned commissions above the
            threshold will be paid out on termination unless withheld for cause.
          </p>
        </Clause>

        <Clause n={11} title="Changes">
          <p>
            We may update these terms or the commission structure. Material changes will be communicated through the
            portal; continued participation constitutes acceptance.
          </p>
        </Clause>

        <Clause n={12} title="Liability">
          <p>
            To the maximum extent permitted by law, WhoGoes&apos;s total liability under the Program is limited to the
            commissions payable to you. We are not liable for indirect or consequential losses.
          </p>
        </Clause>

        <Clause n={13} title="Governing law">
          <p>
            These terms are governed by the laws of India. Disputes are subject to the exclusive jurisdiction of the
            courts of Pune, Maharashtra.
          </p>
        </Clause>

        <p className="mt-8 border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Questions? Email{" "}
          <a href="mailto:hello@whogoes.co" className="text-emerald-600 hover:underline">hello@whogoes.co</a>.
        </p>
      </main>
    </div>
  );
}
