import Link from "next/link";
import type { BrowsableEvent, ContactPreview } from "@/types";

/**
 * Server-rendered, indexable content block for public event pages.
 *
 * Renders BELOW the conversion UI (preview + unlock), so the above-the-fold
 * experience is unchanged. Everything here is rendered server-side and is
 * identical for logged-out and logged-in visitors (Googlebot is always
 * logged-out), which is what makes it indexable.
 *
 * FACTUAL ACCURACY RULES (do not relax - these protect us from misleading-content
 * penalties and keep AEO citations correct):
 *  - WhoGoes is NOT the official attendee list. We only identify people who
 *    publicly posted on LinkedIn about attending - a small, high-intent SUBSET
 *    of total attendees. Copy never states our count as the event's attendance,
 *    always attributes it ("WhoGoes has identified N from public LinkedIn posts"),
 *    and always includes the subset disclaimer.
 *  - Contact rotation: the preview shows the most-recent public posters, so
 *    individuals churn. "Who Attends" uses aggregate roles + companies only,
 *    never named individuals (stable across rotation, no PII).
 *  - Live/changing counts: for actively-collecting events the count changes
 *    daily, so prose uses a rounded floor ("1,000+", "updated daily") instead of
 *    a precise figure that would go stale. Completed events use the exact count.
 */

interface Faq {
  question: string;
  answer: string;
}

function isUpcoming(startDate: string | null): boolean {
  if (!startDate) return false;
  return new Date(startDate).getTime() > Date.now();
}

function formatMonthYear(startDate: string | null): string | null {
  if (!startDate) return null;
  const parsed = new Date(startDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * How we phrase the tracked count.
 *  - Actively collecting (count changes daily): rounded floor, never an exact
 *    figure that would go stale between crawls. e.g. 1,002 -> "1,000+".
 *  - Collection complete: exact count is stable and safe.
 */
function trackedCountPhrase(total: number, isActive: boolean): string {
  if (isActive) {
    const floor = Math.floor(total / 100) * 100;
    return floor >= 100 ? `${floor.toLocaleString()}+` : "a growing set of";
  }
  return total.toLocaleString();
}

function topCompanies(previews: ContactPreview[], max = 6): string[] {
  const seen = new Set<string>();
  const companies: string[] = [];
  for (const preview of previews) {
    const company = preview.company_name?.trim();
    if (!company) continue;
    const key = company.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    companies.push(company);
    if (companies.length >= max) break;
  }
  return companies;
}

function topTitles(previews: ContactPreview[], max = 5): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const preview of previews) {
    const title = preview.current_title?.trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
    if (titles.length >= max) break;
  }
  return titles;
}

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function eventLabelFor(event: BrowsableEvent): string {
  const nameIncludesYear = event.event_name.includes(String(event.event_year));
  return nameIncludesYear ? event.event_name : `${event.event_name} ${event.event_year}`;
}

function buildFaqs(event: BrowsableEvent): Faq[] {
  const eventLabel = eventLabelFor(event);
  const upcoming = isUpcoming(event.event_start_date);
  const isActive = event.is_whogoes_active;
  const countPhrase = trackedCountPhrase(event.total_contacts, isActive);
  const withEmail = event.contacts_with_email.toLocaleString();
  const attendVerb = upcoming ? "attend" : "attended";

  const subsetNote =
    "These are people who publicly posted about attending on LinkedIn, a high-intent subset of total attendees, not an official or complete registration list.";

  const faqs: Faq[] = [
    {
      // Note: we answer "how many WhoGoes has identified", NOT total attendance.
      question: `How many ${eventLabel} attendees has WhoGoes identified?`,
      answer: isActive
        ? `WhoGoes has identified ${countPhrase} verified ${eventLabel} attendees from public LinkedIn posts, and the count updates daily as more people post. ${subsetNote}`
        : `WhoGoes identified ${countPhrase} verified ${eventLabel} attendees from public LinkedIn posts, including ${withEmail} with verified work emails. ${subsetNote}`,
    },
    {
      question: `Who ${attendVerb}s ${eventLabel}?`,
      answer: event.event_industry
        ? `Among the ${eventLabel} attendees WhoGoes has identified from LinkedIn, you'll find ${event.event_industry} professionals from individual contributors to senior decision-makers. We surface the specific roles and companies represented so you can target the right people.`
        : `Among the ${eventLabel} attendees WhoGoes has identified from LinkedIn, you'll find a mix of practitioners and senior decision-makers across the companies attending. We surface the specific roles and companies represented so you can target the right people.`,
    },
    {
      question: `How do I get the ${eventLabel} attendee list?`,
      answer: `Preview 5 verified ${eventLabel} contacts free on this page, then unlock more starting at $29 for 200 contacts. No subscription, no contract. Each contact includes name, job title, company, verified email, and a link to the LinkedIn post that shows they posted about attending.`,
    },
    {
      question: `Is the ${eventLabel} attendee data accurate?`,
      answer: `Every ${eventLabel} contact comes with a link to the public LinkedIn post where the person announced their plans. That is proof of attendance intent, which is what separates this from a stale purchased list. It does not claim to be the full event roster, only the verified attendees we can prove from public posts.`,
    },
  ];

  return faqs;
}

export function EventSeoFaqJsonLd({ faqs }: { faqs: Faq[] }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

export function getEventFaqs(event: BrowsableEvent): Faq[] {
  return buildFaqs(event);
}

export default function EventSeoContent({
  event,
  previews,
  hasBlog,
  blogSlug,
  blogTitle,
}: {
  event: BrowsableEvent;
  previews: ContactPreview[];
  hasBlog: boolean;
  blogSlug?: string;
  blogTitle?: string;
}) {
  const upcoming = isUpcoming(event.event_start_date);
  const isActive = event.is_whogoes_active;
  const monthYear = formatMonthYear(event.event_start_date);
  const eventLabel = eventLabelFor(event);
  const countPhrase = trackedCountPhrase(event.total_contacts, isActive);

  const companies = topCompanies(previews);
  const titles = topTitles(previews);
  const faqs = buildFaqs(event);

  const whenWhere = [
    monthYear ? `${upcoming ? "takes place in" : "took place in"} ${monthYear}` : null,
    event.event_location ? `in ${event.event_location}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="mx-auto mt-2 max-w-4xl px-4 pb-16">
      <div className="prose prose-zinc max-w-none dark:prose-invert">
        {/* About */}
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          About {eventLabel}
        </h2>
        <p className="mt-2 text-zinc-600 dark:text-zinc-300">
          {eventLabel}
          {whenWhere ? ` ${whenWhere}` : ""}
          {event.event_industry
            ? ` and brings together professionals across the ${event.event_industry} sector.`
            : "."}{" "}
          {isActive ? (
            <>
              WhoGoes is actively tracking who&apos;s {upcoming ? "attending" : "attended"} by
              monitoring public LinkedIn posts, updated daily. So far we&apos;ve identified{" "}
              <strong>{countPhrase}</strong> verified attendees, including many with verified work
              emails.
            </>
          ) : (
            <>
              WhoGoes identified <strong>{countPhrase}</strong> verified attendees for this event
              from public LinkedIn posts, including{" "}
              <strong>{event.contacts_with_email.toLocaleString()}</strong> with verified work
              emails.
            </>
          )}{" "}
          These are people who publicly posted about attending, a high-intent subset of total
          attendees, not an official or complete registration list.
        </p>

        {/* Who Attends - aggregate roles + companies only, never named people */}
        <h2 className="mt-6 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Who {upcoming ? "Attends" : "Attended"} {eventLabel}
        </h2>
        <p className="mt-2 text-zinc-600 dark:text-zinc-300">
          Among the {eventLabel} attendees WhoGoes has identified from LinkedIn,{" "}
          {titles.length > 0 ? (
            <>
              roles represented include <strong>{joinWithAnd(titles)}</strong>.{" "}
            </>
          ) : (
            <>
              you&apos;ll find a range from individual contributors to senior decision-makers
              {event.event_industry ? ` across ${event.event_industry}` : ""}.{" "}
            </>
          )}
          {companies.length > 0 && (
            <>
              Companies represented include <strong>{joinWithAnd(companies)}</strong>, among others.
            </>
          )}
        </p>

        {/* How to Get the List - points the keyword to the blog when one exists */}
        <h2 className="mt-6 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          How to Get the {eventLabel} Attendee List
        </h2>
        <p className="mt-2 text-zinc-600 dark:text-zinc-300">
          Preview 5 verified contacts free above, then unlock more from $29 for 200 contacts. No
          subscription, no contract, and credits never expire. Every contact includes a name, job
          title, company, verified email, and a link to the LinkedIn post that shows they posted
          about attending.
          {hasBlog && blogSlug && (
            <>
              {" "}
              For the complete outreach playbook, read{" "}
              <Link
                href={`/blog/${blogSlug}`}
                className="font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                {blogTitle ?? `the ${eventLabel} attendee list guide`}
              </Link>
              .
            </>
          )}
        </p>

        {/* FAQ */}
        <h2 className="mt-6 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          {eventLabel} Attendee List FAQ
        </h2>
        <dl className="mt-2 space-y-4">
          {faqs.map((faq) => (
            <div key={faq.question}>
              <dt className="font-medium text-zinc-900 dark:text-zinc-100">{faq.question}</dt>
              <dd className="mt-1 text-zinc-600 dark:text-zinc-300">{faq.answer}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
