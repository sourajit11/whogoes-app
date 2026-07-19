"use client";

// Findymail-style three-panel API docs: left nav with scroll-spy highlighting,
// middle column with endpoint parameters, right column with dark code panels
// (example request with a global bash/javascript toggle, example responses).
// Content mirrors docs/API.md; update both together.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";

const LAST_UPDATED = "July 19, 2026";

/* ----------------------------- language tabs ----------------------------- */

type Lang = "bash" | "javascript";
const LangContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
}>({ lang: "bash", setLang: () => {} });

/* ------------------------------- utilities ------------------------------- */

// Renders `backtick` code spans and **bold** runs inside plain strings.
function Codes({ children }: { children: string }) {
  const parts = children.split("`");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code
            key={i}
            className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {part}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function T({ children }: { children: string }) {
  const parts = children.split("**");
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong
            key={i}
            className="font-semibold text-zinc-800 dark:text-zinc-200"
          >
            <Codes>{part}</Codes>
          </strong>
        ) : (
          <Codes key={i}>{part}</Codes>
        ),
      )}
    </>
  );
}

function MethodBadge({ method }: { method: "GET" | "POST" }) {
  return (
    <span
      className={
        method === "GET"
          ? "inline-block rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white"
          : "inline-block rounded-md bg-zinc-900 px-2 py-0.5 text-xs font-bold text-white ring-1 ring-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
      }
    >
      {method}
    </span>
  );
}

function CostBadge({ spends }: { spends?: boolean }) {
  return spends ? (
    <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
      spends credits
    </span>
  ) : (
    <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400">
      free
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-rose-50 px-1.5 py-0.5 font-mono text-[13px] font-semibold text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
      {children}
    </code>
  );
}

/* ------------------------------ param blocks ------------------------------ */

interface DocParam {
  name: string;
  type?: string;
  tag?: "required" | "optional" | "recommended";
  description: string;
  example?: string;
}

function ParamBlock({ title, params }: { title: string; params: DocParam[] }) {
  return (
    <div className="mt-6">
      <div className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-800 dark:bg-zinc-800/60 dark:text-zinc-200">
        {title}
      </div>
      <div className="mt-3 space-y-4">
        {params.map((p) => (
          <div key={p.name}>
            <div className="flex flex-wrap items-baseline gap-2">
              <Chip>{p.name}</Chip>
              {p.type ? (
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {p.type}
                </span>
              ) : null}
              {p.tag && p.tag !== "required" ? (
                <span className="text-xs italic text-zinc-500 dark:text-zinc-400">
                  {p.tag}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              <T>{p.description}</T>
              {p.example ? (
                <>
                  {" "}
                  Example:{" "}
                  <code className="rounded bg-rose-50 px-1 py-0.5 font-mono text-[0.85em] text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
                    {p.example}
                  </code>
                </>
              ) : null}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------- code panels ------------------------------ */

function CodePanel({ title, code }: { title: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-400">
        {title}
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-zinc-100">
        {code}
      </pre>
    </div>
  );
}

function RequestPanel({ bash, js }: { bash: string; js?: string }) {
  const { lang, setLang } = useContext(LangContext);
  const showJs = js && lang === "javascript";
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <span className="text-xs font-medium text-zinc-400">
          Example request
        </span>
        {js ? (
          <div className="flex gap-1">
            {(["bash", "javascript"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={
                  lang === l
                    ? "rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-400"
                    : "rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 hover:text-zinc-300"
                }
              >
                {l}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-zinc-100">
        {showJs ? js : bash}
      </pre>
    </div>
  );
}

/* --------------------------------- tables --------------------------------- */

function DocTable({
  head,
  rows,
}: {
  head: string[];
  rows: string[][];
}) {
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-100 dark:bg-zinc-800/60">
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="px-3 py-2 font-semibold text-zinc-700 dark:text-zinc-300"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className="border-t border-zinc-200 align-top dark:border-zinc-800"
            >
              {r.map((c, j) => (
                <td
                  key={j}
                  className="px-3 py-2 text-zinc-600 dark:text-zinc-400"
                >
                  <T>{c}</T>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ page sections ----------------------------- */

function SectionShell({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-zinc-200 py-10 dark:border-zinc-800">
      {children}
    </section>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">
      {children}
    </h2>
  );
}

function P({ children }: { children: string }) {
  return (
    <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
      <T>{children}</T>
    </p>
  );
}

interface EndpointProps {
  id: string;
  method: "GET" | "POST";
  path: string;
  spends?: boolean;
  summary: string;
  left: ReactNode;
  right: ReactNode;
}

function Endpoint({ id, method, path, spends, summary, left, right }: EndpointProps) {
  return (
    <SectionShell id={id}>
      <div className="flex flex-wrap items-center gap-3">
        <MethodBadge method={method} />
        <code className="font-mono text-[15px] font-semibold text-zinc-900 dark:text-zinc-100">
          {path}
        </code>
        <CostBadge spends={spends} />
      </div>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
        <T>{summary}</T>
      </p>
      <div className="mt-6 grid gap-8 xl:grid-cols-2">
        <div className="min-w-0">{left}</div>
        <div className="min-w-0 space-y-4">{right}</div>
      </div>
    </SectionShell>
  );
}

/* ------------------------------- navigation ------------------------------- */

interface NavItem {
  id: string;
  label: string;
  method?: "GET" | "POST";
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: "Getting started",
    items: [
      { id: "introduction", label: "Introduction" },
      { id: "quick-start", label: "Quick start" },
      { id: "authentication", label: "Authentication" },
      { id: "pricing", label: "Pricing" },
      { id: "icp-filters", label: "ICP filters reference" },
    ],
  },
  {
    label: "Events",
    items: [
      { id: "get-v1-events", label: "/events", method: "GET" },
      { id: "get-v1-events-idorslug-status", label: "/events/{id}/status", method: "GET" },
      { id: "get-v1-events-idorslug-filter", label: "/events/{id}/filter", method: "GET" },
    ],
  },
  {
    label: "Buying contacts",
    items: [
      { id: "post-v1-events-idorslug-unlock", label: "/events/{id}/unlock", method: "POST" },
      { id: "post-v1-events-idorslug-reveal-emails", label: "/events/{id}/reveal-emails", method: "POST" },
    ],
  },
  {
    label: "Your contacts",
    items: [
      { id: "get-v1-events-idorslug-contacts", label: "/events/{id}/contacts", method: "GET" },
      { id: "get-v1-contacts", label: "/contacts", method: "GET" },
    ],
  },
  {
    label: "Guides & reference",
    items: [
      { id: "syncing", label: "Syncing on a schedule" },
      { id: "get-v1-credits", label: "/credits", method: "GET" },
      { id: "rate-limits", label: "Rate limits & spend caps" },
      { id: "errors", label: "Errors" },
      { id: "versioning", label: "Versioning & changelog" },
    ],
  },
];

function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? "");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-15% 0px -75% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

function NavLinks({
  active,
  query,
  onNavigate,
}: {
  active: string;
  query: string;
  onNavigate?: () => void;
}) {
  const q = query.trim().toLowerCase();
  return (
    <div className="space-y-5">
      {NAV.map((group) => {
        const items = q
          ? group.items.filter(
              (i) =>
                i.label.toLowerCase().includes(q) ||
                (i.method ?? "").toLowerCase().includes(q) ||
                group.label.toLowerCase().includes(q),
            )
          : group.items;
        if (items.length === 0) return null;
        return (
          <div key={group.label}>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const isActive = active === item.id;
                return (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      onClick={onNavigate}
                      className={
                        isActive
                          ? "flex items-center gap-2 rounded-md bg-emerald-600 px-2.5 py-1.5 text-sm font-medium text-white"
                          : "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
                      }
                    >
                      {item.method ? (
                        <span
                          className={
                            isActive
                              ? "font-mono text-[10px] font-bold"
                              : item.method === "GET"
                                ? "font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400"
                                : "font-mono text-[10px] font-bold text-zinc-500 dark:text-zinc-400"
                          }
                        >
                          {item.method}
                        </span>
                      ) : null}
                      <span className={item.method ? "font-mono text-[13px]" : ""}>
                        {item.label}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------- content -------------------------------- */

const CURL_EVENTS = `curl --request GET \\
  "https://app.whogoes.co/api/v1/events?status=active&industry=Cybersecurity&limit=2" \\
  --header "Authorization: Bearer $WG_KEY"`;

const JS_EVENTS = `const res = await fetch(
  "https://app.whogoes.co/api/v1/events?" +
    new URLSearchParams({ status: "active", industry: "Cybersecurity", limit: "2" }),
  { headers: { Authorization: "Bearer " + WG_KEY } }
);
const { data } = await res.json();`;

const RESP_EVENTS = `{
  "data": {
    "events": [
      {
        "event_id": "01109f9a-5aa0-47fc-9ef8-9d59b75936e1",
        "event_name": "Black Hat USA 2026",
        "event_slug": "black-hat-usa-2026",
        "event_year": 2026,
        "event_region": "US",
        "event_country": "United States",
        "event_location": "Las Vegas",
        "event_start_date": "2026-08-01",
        "event_industry": "Cybersecurity",
        "status": "active",
        "total_contacts": 2340,
        "contacts_with_email": 1959,
        "counts_cached_at": "2026-07-19T06:15:00.117235+00:00"
      },
      {
        "event_id": "32a569f3-02c0-47a5-a08f-8b76d134c3cc",
        "event_name": "DEF CON 34",
        "event_slug": "def-con-34",
        "event_year": 2026,
        "event_region": "US",
        "event_country": "United States",
        "event_location": "Las Vegas",
        "event_start_date": "2026-08-06",
        "event_industry": "Cybersecurity",
        "status": "active",
        "total_contacts": 994,
        "contacts_with_email": 717,
        "counts_cached_at": "2026-07-19T06:15:00.117235+00:00"
      }
    ],
    "total": 12,
    "limit": 2,
    "offset": 0,
    "has_more": true
  }
}`;

const CURL_STATUS = `curl --request GET \\
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/status" \\
  --header "Authorization: Bearer $WG_KEY"`;

const JS_STATUS = `const res = await fetch(
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/status",
  { headers: { Authorization: "Bearer " + WG_KEY } }
);
const { data } = await res.json();`;

const RESP_STATUS = `{
  "data": {
    "total_contacts": 2340,
    "contacts_with_email": 1959,
    "unlocked_count": 150,
    "emails_unlocked": 150,
    "remaining_count": 2190,
    "user_balance": 4552
  }
}`;

const CURL_FILTER = `curl --request GET \\
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/filter?seniority=C-Suite,VP&has_email=true" \\
  --header "Authorization: Bearer $WG_KEY"`;

const JS_FILTER = `const res = await fetch(
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/filter?" +
    new URLSearchParams({ seniority: "C-Suite,VP", has_email: "true" }),
  { headers: { Authorization: "Bearer " + WG_KEY } }
);
const { data } = await res.json();`;

const RESP_FILTER = `{
  "data": {
    "matched": 26,
    "with_email": 26,
    "owned": 0,
    "by_seniority": [
      { "key": "C-Suite", "count": 18 },
      { "key": "VP", "count": 8 }
    ],
    "by_function": [
      { "key": "Executive/General Mgmt", "count": 17 },
      { "key": "Sales/BD", "count": 7 },
      { "key": "Operations", "count": 2 }
    ],
    "by_role": [
      { "key": "exhibitor", "count": 10 },
      { "key": "expected_attendee", "count": 9 },
      { "key": "attendee", "count": 5 },
      { "key": "sponsor", "count": 2 }
    ],
    "by_industry": [ { "key": "Software & IT Services", "count": 12 } ],
    "by_size": [ { "key": "51-200", "count": 9 } ],
    "by_country": [ { "key": "United States", "count": 21 } ],
    "top_companies": [ { "key": "Meridian Security", "count": 3 } ]
  }
}`;

const RESP_FILTER_400 = `{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid role value(s): ceo. Valid roles: organizer, sponsor, exhibitor, attendee, expected_attendee"
  }
}`;

const CURL_UNLOCK = `curl --request POST \\
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/unlock" \\
  --header "Authorization: Bearer $WG_KEY" \\
  --header "Content-Type: application/json" \\
  --header "Idempotency-Key: $(uuidgen)" \\
  --data '{
    "count": 100,
    "filters": {
      "seniority": ["C-Suite", "VP"],
      "industry": ["Software & IT Services"]
    },
    "include_emails": true
  }'`;

const JS_UNLOCK = `const res = await fetch(
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/unlock",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer " + WG_KEY,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      count: 100,
      filters: {
        seniority: ["C-Suite", "VP"],
        industry: ["Software & IT Services"],
      },
      include_emails: true,
    }),
  }
);
const { data } = await res.json();`;

const RESP_UNLOCK = `{
  "data": {
    "success": true,
    "message": "100 contacts unlocked",
    "contacts_unlocked": 100,
    "emails_included": 0,
    "emails_revealed": 87,
    "credits_spent": 187,
    "new_balance": 4365,
    "batch_id": "0f2e602e-4766-4f55-b289-d4858ebe0bb7",
    "no_icp": false,
    "has_more": true
  }
}`;

const RESP_UNLOCK_EMPTY = `{
  "data": {
    "success": false,
    "message": "No more contacts to unlock"
  }
}`;

const CURL_REVEAL = `curl --request POST \\
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/reveal-emails" \\
  --header "Authorization: Bearer $WG_KEY" \\
  --header "Content-Type: application/json" \\
  --data '{"contact_ids": ["9b0708e8-7b74-453f-a69a-2f6a95ce46be"]}'`;

const JS_REVEAL = `const res = await fetch(
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/reveal-emails",
  {
    method: "POST",
    headers: {
      Authorization: "Bearer " + WG_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contact_ids: ["9b0708e8-7b74-453f-a69a-2f6a95ce46be"],
    }),
  }
);
const { data } = await res.json();`;

const RESP_REVEAL = `{
  "data": {
    "success": true,
    "emails_revealed": 1,
    "credits_spent": 1,
    "new_balance": 4563,
    "revealed": [
      {
        "contact_id": "9b0708e8-7b74-453f-a69a-2f6a95ce46be",
        "email": "jordan@meridiansecurity.com"
      }
    ]
  }
}`;

const RESP_REVEAL_EMPTY = `{
  "data": {
    "success": false,
    "message": "No emails to reveal"
  }
}`;

const CURL_EVENT_CONTACTS = `curl --request GET \\
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/contacts?sort=post_date&dir=desc&limit=1" \\
  --header "Authorization: Bearer $WG_KEY"`;

const JS_EVENT_CONTACTS = `const res = await fetch(
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/contacts?" +
    new URLSearchParams({ sort: "post_date", dir: "desc", limit: "1" }),
  { headers: { Authorization: "Bearer " + WG_KEY } }
);
const { data } = await res.json();`;

const RESP_EVENT_CONTACTS = `{
  "data": {
    "contacts": [
      {
        "contact_id": "9b0708e8-7b74-453f-a69a-2f6a95ce46be",
        "full_name": "Jordan Reyes",
        "first_name": "Jordan",
        "last_name": "Reyes",
        "current_title": "Chief Information Security Officer",
        "headline": "CISO at Meridian Security",
        "contact_linkedin_url": "https://www.linkedin.com/in/jordan-reyes",
        "city": "Austin",
        "country": "United States",
        "email": "jordan@meridiansecurity.com",
        "email_status": "valid",
        "email_provider": "google",
        "has_email": true,
        "email_unlocked": true,
        "company_name": "Meridian Security",
        "company_linkedin_url": "https://www.linkedin.com/company/meridian-security",
        "company_domain": "meridiansecurity.com",
        "company_website": "https://www.meridiansecurity.com",
        "company_industry": "Computer & Network Security",
        "company_industry_bucket": "Software & IT Services",
        "company_size": "51-200",
        "company_size_bucket": "51-200",
        "company_headquarters": "Austin, Texas",
        "company_founded_year": 2014,
        "event_role": "attendee",
        "is_speaker": false,
        "post_url": "https://www.linkedin.com/posts/activity-7483880826611412992-uBzz",
        "post_date": "2026-07-17T13:50:32.846+00:00",
        "source": "post_author",
        "unlocked_at": "2026-07-19T06:48:19.34118+00:00",
        "batch_id": "eeebea41-cd02-4a49-bf12-bab4472792f0"
      }
    ],
    "total": 150,
    "limit": 1,
    "offset": 0,
    "has_more": true
  }
}`;

const CURL_ALL_CONTACTS = `curl --request GET \\
  "https://app.whogoes.co/api/v1/contacts?since=2026-07-18T00:00:00Z&limit=200" \\
  --header "Authorization: Bearer $WG_KEY"`;

const JS_ALL_CONTACTS = `const res = await fetch(
  "https://app.whogoes.co/api/v1/contacts?" +
    new URLSearchParams({ since: "2026-07-18T00:00:00Z", limit: "200" }),
  { headers: { Authorization: "Bearer " + WG_KEY } }
);
const { data } = await res.json();`;

const RESP_ALL_CONTACTS = `{
  "data": {
    "contacts": [
      {
        "contact_id": "9b0708e8-7b74-453f-a69a-2f6a95ce46be",
        "full_name": "Jordan Reyes",
        "current_title": "Chief Information Security Officer",
        "company_name": "Meridian Security",
        "email": "jordan@meridiansecurity.com",
        "email_unlocked": true,
        "event_id": "01109f9a-5aa0-47fc-9ef8-9d59b75936e1",
        "event_slug": "black-hat-usa-2026",
        "event_name": "Black Hat USA 2026",
        "unlocked_at": "2026-07-19T06:48:19.34118+00:00"
      }
    ],
    "total": 431,
    "limit": 200,
    "offset": 0,
    "since": "2026-07-18T00:00:00+00:00",
    "watermark": "2026-07-19T06:49:11.503241+00:00",
    "has_more": true
  }
}`;

const CURL_CREDITS = `curl --request GET \\
  "https://app.whogoes.co/api/v1/credits" \\
  --header "Authorization: Bearer $WG_KEY"`;

const JS_CREDITS = `const res = await fetch("https://app.whogoes.co/api/v1/credits", {
  headers: { Authorization: "Bearer " + WG_KEY },
});
const { data } = await res.json();`;

const RESP_CREDITS = `{
  "data": {
    "balance": 4552,
    "daily_cap": 200,
    "spent_today": 50,
    "remaining_today": 150
  }
}`;

const QUICKSTART_CODE = `export WG_KEY="wg_your_actual_key_here"

# 1. Find an event (same filters as the Browse Events page)
curl -H "Authorization: Bearer $WG_KEY" \\
  "https://app.whogoes.co/api/v1/events?status=active&q=black%20hat"

# 2. Unlock 25 contacts matching your ICP, emails included
curl -X POST \\
  -H "Authorization: Bearer $WG_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"count": 25, "filters": {"seniority": ["C-Suite", "VP"], "has_email": true}}' \\
  https://app.whogoes.co/api/v1/events/black-hat-usa-2026/unlock

# 3. Fetch the contacts you now own
curl -H "Authorization: Bearer $WG_KEY" \\
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/contacts?limit=100"`;

const QUICKSTART_RESP = `{
  "data": {
    "success": true,
    "message": "25 contacts unlocked",
    "contacts_unlocked": 25,
    "emails_included": 0,
    "emails_revealed": 25,
    "credits_spent": 50,
    "new_balance": 950,
    "batch_id": "85e0e828-90d6-4f42-97f2-b883d58e5615",
    "no_icp": false,
    "has_more": true
  }
}`;

const RESP_401 = `{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or revoked API key."
  }
}`;

const SYNC_STEP1 = `# Check what a run would deliver (free)
curl -H "Authorization: Bearer $WG_KEY" \\
  "https://app.whogoes.co/api/v1/events/black-hat-usa-2026/filter?seniority=C-Suite,VP&has_email=true"

# -> { "matched": 40, "owned": 25, ... }
#    15 new people since your last run`;

const SYNC_STEP2 = `# Buy the newcomers (same call as your first unlock, re-sent)
curl -X POST -H "Authorization: Bearer $WG_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"count": 500, "filters": {"seniority": ["C-Suite", "VP"], "has_email": true}}' \\
  https://app.whogoes.co/api/v1/events/black-hat-usa-2026/unlock

# -> { "contacts_unlocked": 15, "credits_spent": 15, "has_more": false, ... }`;

const SYNC_STEP3 = `# First ever run: everything you own
curl -H "Authorization: Bearer $WG_KEY" \\
  "https://app.whogoes.co/api/v1/contacts?since=1970-01-01T00:00:00Z&limit=200"

# Every later run: only what is new since the stored watermark
curl -H "Authorization: Bearer $WG_KEY" \\
  "https://app.whogoes.co/api/v1/contacts?since=$LAST_WATERMARK&limit=200"`;

const RESP_402 = `{
  "error": {
    "code": "SPEND_CAP_EXCEEDED",
    "message": "Daily credit cap reached for this API key. Resets at UTC midnight."
  }
}`;

/* --------------------------------- page ---------------------------------- */

export default function ApiDocs() {
  const [lang, setLang] = useState<Lang>("bash");
  const [query, setQuery] = useState("");
  const allIds = useMemo(
    () => NAV.flatMap((g) => g.items.map((i) => i.id)),
    [],
  );
  const active = useScrollSpy(allIds);

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-950">
        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="mx-auto flex h-14 max-w-[90rem] items-center justify-between px-6">
            <a href="https://whogoes.co" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500">
                <span className="text-sm font-bold text-white">W</span>
              </div>
              <span className="text-lg font-bold text-zinc-900 dark:text-white">
                WhoGoes
              </span>
              <span className="hidden lg:inline-block border-l border-zinc-300 pl-2.5 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                API Documentation
              </span>
            </a>
            <nav className="flex items-center gap-3">
              <Link
                href="/events"
                className="hidden text-sm text-zinc-600 transition-colors hover:text-zinc-900 sm:inline dark:text-zinc-400 dark:hover:text-white"
              >
                Events
              </Link>
              <Link
                href="/login"
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
              >
                Start Free
              </Link>
            </nav>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-[90rem] flex-1 gap-8 px-6">
          {/* left nav */}
          <aside className="hidden w-72 shrink-0 lg:block">
            <nav className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto py-8 pr-3">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="mb-5 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 placeholder-zinc-400 outline-none focus:border-emerald-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
              />
              <NavLinks active={active} query={query} />
              <div className="mt-8 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950">
                <p className="text-sm font-medium text-zinc-900 dark:text-white">
                  Need a key?
                </p>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Create API keys under Dashboard, then Integrations.
                </p>
                <Link
                  href="/dashboard/integrations"
                  className="mt-2 inline-block text-sm font-semibold text-emerald-700 hover:text-emerald-600 dark:text-emerald-400"
                >
                  Open Integrations
                </Link>
              </div>
              <p className="mt-6 text-xs text-zinc-400 dark:text-zinc-500">
                Last updated: {LAST_UPDATED}
              </p>
            </nav>
          </aside>

          {/* content */}
          <main className="min-w-0 flex-1 pb-16">
            {/* mobile nav */}
            <details className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 lg:hidden dark:border-zinc-800 dark:bg-zinc-900">
              <summary className="cursor-pointer text-sm font-semibold text-zinc-900 dark:text-white">
                On this page
              </summary>
              <div className="mt-3">
                <NavLinks active={active} query="" />
              </div>
            </details>

            {/* Introduction */}
            <SectionShell id="introduction">
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">
                WhoGoes Public API
              </h1>
              <P>
                Trade show and event attendee lists, with proof, over REST. Browse the same events you see in the app, check exactly who matches your ICP filters, unlock contacts with verified emails, and keep pulling new matches on whatever schedule you run. Credits are deducted from your WhoGoes account as you unlock, and you never pay twice for the same contact.
              </P>
              <P>
                The API mirrors the app: every value you see in the dashboard (statuses, filter options, counts) is the same value you pass here.
              </P>
              <div className="mt-6 grid gap-8 xl:grid-cols-2">
                <div>
                  <ParamBlock
                    title="Base URL"
                    params={[
                      {
                        name: "https://app.whogoes.co/api/v1",
                        description:
                          "All endpoint paths below are relative to this base.",
                      },
                    ]}
                  />
                  <DocTable
                    head={["Method", "Path", "What it does", "Cost"]}
                    rows={[
                      ["GET", "`/events`", "Browse events, same filters as the app", "Free"],
                      ["GET", "`/events/{id}/status`", "Live totals plus your position on one event", "Free"],
                      ["GET", "`/events/{id}/filter`", "Apply ICP filters, see matches and cost before buying", "Free"],
                      ["POST", "`/events/{id}/unlock`", "Buy contacts", "Credits"],
                      ["POST", "`/events/{id}/reveal-emails`", "Buy emails for contacts you own", "Credits"],
                      ["GET", "`/events/{id}/contacts`", "Read what you own on one event", "Free"],
                      ["GET", "`/contacts`", "Read everything you own, or sync incrementally", "Free"],
                      ["GET", "`/credits`", "Balance and daily cap state", "Free"],
                    ]}
                  />
                </div>
                <div className="space-y-4">
                  <CodePanel
                    title="Every response is JSON"
                    code={`// Success
{ "data": ... }

// Error
{ "error": { "code": "...", "message": "..." } }`}
                  />
                </div>
              </div>
            </SectionShell>

            {/* Quick start */}
            <SectionShell id="quick-start">
              <SectionTitle>Quick start</SectionTitle>
              <P>
                You need an API key first: buy credits at `app.whogoes.co/dashboard/billing`, then create a key under Dashboard, Integrations. That is the only time you need the app; everything below is pure API.
              </P>
              <P>
                Three calls take you from nothing to owned contacts: find an event, unlock the people who match your ICP, read them back.
              </P>
              <div className="mt-6 grid gap-8 xl:grid-cols-2">
                <div className="space-y-4">
                  <CodePanel title="Zero to contacts in 3 calls" code={QUICKSTART_CODE} />
                </div>
                <div className="space-y-4">
                  <CodePanel
                    title="Example response (unlock): 25 identities + 25 emails = 50 credits"
                    code={QUICKSTART_RESP}
                  />
                </div>
              </div>
            </SectionShell>

            {/* Authentication */}
            <SectionShell id="authentication">
              <SectionTitle>Authentication</SectionTitle>
              <P>
                Every request needs a Bearer token. Keys are 67-character strings beginning with `wg_`. A key is shown once at creation and only its SHA-256 hash is stored; lose it and you revoke and create a new one.
              </P>
              <div className="mt-2 grid gap-8 xl:grid-cols-2">
                <div>
                  <ParamBlock
                    title="Headers"
                    params={[
                      {
                        name: "Authorization",
                        tag: "required",
                        description: "Your API key as a Bearer token.",
                        example: "Bearer wg_a1b2c3d4...",
                      },
                      {
                        name: "Content-Type",
                        description: "POST requests only.",
                        example: "application/json",
                      },
                    ]}
                  />
                  <div className="mt-6 space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    <p>
                      <T>
                        **Eligibility**: API access requires having purchased credits at least once. Free trial credits do not unlock the API.
                      </T>
                    </p>
                    <p>
                      <T>
                        **Managing keys**: create, rename, cap, and revoke keys under Dashboard, Integrations. Up to 5 active keys per account. Each key can carry an optional daily credit cap (see Rate limits).
                      </T>
                    </p>
                  </div>
                </div>
                <div className="space-y-4">
                  <CodePanel
                    title="Example response (401): always JSON, never a login redirect"
                    code={RESP_401}
                  />
                </div>
              </div>
            </SectionShell>

            {/* Pricing */}
            <SectionShell id="pricing">
              <SectionTitle>Pricing</SectionTitle>
              <P>
                Credits come from your WhoGoes balance (free trial credits are spent before paid credits). One contact identity = 1 credit. Verified emails are either included or +1 credit, depending on whether you filter:
              </P>
              <DocTable
                head={["Unlock type", "Identity", "Verified email", "Total per contact"]}
                rows={[
                  ["No filters (or only `has_email`)", "1 credit", "included", "1 credit"],
                  ["ICP filters, `include_emails: true` (default)", "1 credit", "+1 credit if the contact has one", "1 or 2 credits"],
                  ["ICP filters, `include_emails: false`", "1 credit", "not unlocked", "1 credit"],
                  ["Reveal later via `reveal-emails`", "already paid", "1 credit per email revealed", "+1 credit"],
                ]}
              />
              <ul className="mt-5 max-w-3xl list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <li>
                  <T>`has_email: true` on its own is not an ICP filter. It just restricts the pool to contacts with verified emails and prices like an unfiltered unlock.</T>
                </li>
                <li>
                  <T>You are only charged for emails that exist: a filtered `include_emails` unlock charges +1 only for contacts that actually have a verified email.</T>
                </li>
                <li>
                  <T>You never pay twice. Unlocking again with any filters skips contacts you already own, and revealing never re-charges an unlocked email.</T>
                </li>
                <li>
                  <T>Partial fulfillment, never overdraft: if your balance (or a cap) covers less than you asked for, you get what fits and are charged only for that.</T>
                </li>
                <li>
                  <T>Contacts are unlocked best first: verified email holders first, then most recent activity.</T>
                </li>
              </ul>
            </SectionShell>

            {/* ICP filters */}
            <SectionShell id="icp-filters">
              <SectionTitle>ICP filters reference</SectionTitle>
              <P>
                The same filter object works everywhere: unlock bodies, filter queries, and contact reads. These are the same filters you see on an event page in the app.
              </P>
              <DocTable
                head={["Key", "Type", "Values"]}
                rows={[
                  ["`seniority`", "array", "`C-Suite`, `Owner/Founder`, `VP`, `Director`, `Manager`, `IC`, `Other`, `Unknown`"],
                  ["`function`", "array", "`Sales/BD`, `Marketing`, `Operations`, `Finance`, `Engineering/Technical`, `Product`, `IT/Data`, `HR/People`, `Legal/Compliance`, `Procurement/Supply Chain`, `Customer Success`, `Creative & Content`, `Executive/General Mgmt`, `Other`, `Unknown`"],
                  ["`industry`", "array", "Company industry buckets as shown in the app's Industry filter, e.g. `Software & IT Services`, `Industrial Machinery & Automation`. Call the filter endpoint to see the buckets present on your event (`by_industry`). `Unknown` matches uncategorized."],
                  ["`size`", "array", "`1-10`, `11-50`, `51-200`, `201-500`, `501-1000`, `1001-5000`, `5001-10000`, `10001+`, `Unknown`"],
                  ["`country`", "array", "Contact country names as returned by the filter endpoint (`by_country`). `Unknown` matches missing."],
                  ["`role`", "array", "`organizer`, `sponsor`, `exhibitor`, `attendee`, `expected_attendee`"],
                  ["`speaker`", "boolean", "`true` limits to speakers"],
                  ["`has_email`", "boolean", "`true` limits to contacts with a verified email"],
                  ["`title_keyword`", "string", "Case-insensitive match against job title or headline"],
                  ["`company_include`", "string", "Company name must contain this"],
                  ["`company_exclude`", "string", "Company name must not contain this"],
                ]}
              />
              <div className="mt-5 max-w-3xl space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <p>
                  <T>
                    An absent key means no constraint. `role: attendee` means the person posted or was tagged about attending; `expected_attendee` means weaker evidence (a bare repost).
                  </T>
                </p>
                <p>
                  <T>
                    A contact's company `industry` (above) and an event's `industry` (on the events endpoint) are different vocabularies, exactly like in the app: events use the 21 categories from the Browse page, contacts use company industry buckets from the event's filter panel.
                  </T>
                </p>
                <p>
                  <T>
                    **In GET requests** use query params; array values are comma-separated. If a value itself contains a comma, pass the whole object as URL-encoded JSON in a single `filters` param instead (it replaces all individual params). Unknown keys return a 400 listing valid keys. **In POST bodies** pass the object under `"filters"`.
                  </T>
                </p>
              </div>
              <div className="mt-4 max-w-3xl">
                <CodePanel
                  title="Filters in a GET query"
                  code={`GET /v1/events/black-hat-usa-2026/filter?seniority=C-Suite,VP&function=Sales/BD&has_email=true`}
                />
              </div>
            </SectionShell>

            {/* GET /events */}
            <Endpoint
              id="get-v1-events"
              method="GET"
              path="/v1/events"
              summary="Browse events. Mirrors the app's Browse Events page exactly: same statuses, same search, same default ordering (active events first, upcoming first, biggest list first). List counts are refreshed on a schedule; the filter endpoint is the live truth for a specific event. Completed events stay fully usable: you can still filter, unlock, and read contacts on them, exactly like in the app."
              left={
                <>
                  <ParamBlock
                    title="Query Parameters"
                    params={[
                      { name: "status", type: "string", tag: "optional", description: "`active` (list still growing) or `completed` (event finished, list final). Same two values as the Status dropdown in the app. Omit for all events, active first.", example: "active" },
                      { name: "q", type: "string", tag: "optional", description: "Search by event name or location, like the app search box.", example: "black hat" },
                      { name: "year", type: "integer", tag: "optional", description: "Event year.", example: "2026" },
                      { name: "region", type: "string", tag: "optional", description: "`US`, `EU`, or `APAC`. UK and European events are under `EU`.", example: "US" },
                      { name: "country", type: "string", tag: "optional", description: "Full country name.", example: "United States" },
                      { name: "industry", type: "string", tag: "optional", description: "One of the 21 event categories listed below. URL-encode `&` as `%26`.", example: "Technology %26 SaaS" },
                      { name: "min_contacts", type: "integer", tag: "optional", description: "Only events with at least this many contacts.", example: "300" },
                      { name: "starts_after", type: "date", tag: "optional", description: "`YYYY-MM-DD`.", example: "2026-08-01" },
                      { name: "starts_before", type: "date", tag: "optional", description: "`YYYY-MM-DD`.", example: "2026-12-31" },
                      { name: "limit", type: "integer", tag: "optional", description: "Page size, default 50, max 200." },
                      { name: "offset", type: "integer", tag: "optional", description: "Pagination offset, default 0." },
                    ]}
                  />
                  <p className="mt-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    <T>
                      The 21 event categories (same list as the Browse page's Industry dropdown): `Healthcare & Medical`, `Pharma & Life Sciences`, `Technology & SaaS`, `Cybersecurity`, `AI & Data`, `Manufacturing & Industrial`, `Supply Chain & Logistics`, `Retail & E-commerce`, `Finance & FinTech`, `Marketing, Sales & MarTech`, `Legal & LegalTech`, `Construction & Real Estate`, `Energy, Sustainability & CleanTech`, `Automotive & Mobility`, `Aerospace & Defense`, `Food, Beverage & Agriculture`, `Hospitality, Travel & Events`, `Media, Entertainment & Gaming`, `Education & HR`, `Beauty, Fashion & Consumer Goods`, `Cannabis`.
                    </T>
                  </p>
                </>
              }
              right={
                <>
                  <RequestPanel bash={CURL_EVENTS} js={JS_EVENTS} />
                  <CodePanel title="Example response (200)" code={RESP_EVENTS} />
                </>
              }
            />

            {/* GET /events/{id}/status */}
            <Endpoint
              id="get-v1-events-idorslug-status"
              method="GET"
              path="/v1/events/{idOrSlug}/status"
              summary="Live totals for one event plus your position on it. Event routes accept either the event UUID or its slug."
              left={
                <ParamBlock
                  title="Response Fields"
                  params={[
                    { name: "total_contacts", description: "Everyone on this event's list." },
                    { name: "contacts_with_email", description: "How many of them have a verified email." },
                    { name: "unlocked_count", description: "Contacts you own on this event." },
                    { name: "emails_unlocked", description: "How many of your contacts have their email unlocked." },
                    { name: "remaining_count", description: "Contacts you do not own yet." },
                    { name: "user_balance", description: "Your current credit balance." },
                  ]}
                />
              }
              right={
                <>
                  <RequestPanel bash={CURL_STATUS} js={JS_STATUS} />
                  <CodePanel title="Example response (200)" code={RESP_STATUS} />
                </>
              }
            />

            {/* GET /events/{id}/filter */}
            <Endpoint
              id="get-v1-events-idorslug-filter"
              method="GET"
              path="/v1/events/{idOrSlug}/filter"
              summary="Apply ICP filters and see exactly what you would get before spending anything: live match counts, how many you already own, and the same breakdowns you see on an event page in the app. No filters = the whole event."
              left={
                <>
                  <ParamBlock
                    title="Query Parameters"
                    params={[
                      { name: "any ICP filter", description: "See the ICP filters reference above. All filters are optional and combine." },
                    ]}
                  />
                  <ParamBlock
                    title="Response Fields"
                    params={[
                      { name: "matched", description: "Contacts matching your filters right now." },
                      { name: "with_email", description: "How many of the matches have a verified email." },
                      { name: "owned", description: "Matches you already unlocked. `matched` minus `owned` is how many new contacts an unlock would deliver." },
                      { name: "by_*", description: "Breakdowns by seniority, function, role, industry, size, country, plus `top_companies`. Each entry is `{ key, count }`." },
                    ]}
                  />
                  <p className="mt-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    <T>
                      Cost for a filtered unlock with emails is at most `(matched - owned) + with_email` among the new ones; the unlock response reports the exact spend.
                    </T>
                  </p>
                </>
              }
              right={
                <>
                  <RequestPanel bash={CURL_FILTER} js={JS_FILTER} />
                  <CodePanel title="Example response (200)" code={RESP_FILTER} />
                  <CodePanel
                    title="Example response (400): invalid filter value"
                    code={RESP_FILTER_400}
                  />
                </>
              }
            />

            {/* POST unlock */}
            <Endpoint
              id="post-v1-events-idorslug-unlock"
              method="POST"
              path="/v1/events/{idOrSlug}/unlock"
              spends
              summary="Unlocks up to `count` contacts you do not own yet on this event, best first (verified email holders first, then most recent activity). An unlock is always scoped to one event."
              left={
                <>
                  <ParamBlock
                    title="Headers"
                    params={[
                      { name: "Authorization", tag: "required", description: "Bearer token.", example: "Bearer wg_..." },
                      { name: "Content-Type", tag: "required", description: "Must be JSON.", example: "application/json" },
                      { name: "Idempotency-Key", tag: "recommended", description: "Any unique string (a UUID is ideal). Retrying with the same key returns the original response with `Idempotency-Replayed: true` and never double-charges." },
                    ]}
                  />
                  <ParamBlock
                    title="Body Parameters"
                    params={[
                      { name: "count", type: "integer", tag: "required", description: "1 to 10000. Large requests are processed in server-side chunks within one call.", example: "100" },
                      { name: "filters", type: "object", tag: "optional", description: "The ICP filter object. Omit for a full-list unlock (emails included at 1 credit per contact)." },
                      { name: "include_emails", type: "boolean", tag: "optional", description: "Default `true`. On filtered unlocks, bundle the email reveal (+1 credit per contact with a verified email) into this call. Set `false` to buy identities only and reveal selectively later." },
                    ]}
                  />
                  <ParamBlock
                    title="Response Fields"
                    params={[
                      { name: "contacts_unlocked", description: "New contacts you now own from this call." },
                      { name: "emails_included", description: "Emails that came free (unfiltered pricing path)." },
                      { name: "emails_revealed", description: "Emails charged at +1 credit (filtered pricing path)." },
                      { name: "credits_spent", description: "Exact total charged for this call." },
                      { name: "new_balance", description: "Your balance after this call." },
                      { name: "batch_id", description: "This unlock as a batch; the same history is visible in the dashboard." },
                      { name: "no_icp", description: "`true` when the request priced as an unfiltered unlock (no filters, or only `has_email`)." },
                      { name: "has_more", description: "`true` while contacts matching your filters remain that you do not own yet." },
                    ]}
                  />
                </>
              }
              right={
                <>
                  <RequestPanel bash={CURL_UNLOCK} js={JS_UNLOCK} />
                  <CodePanel title="Example response (200)" code={RESP_UNLOCK} />
                  <CodePanel
                    title="Example response (400): pool used up, nothing charged"
                    code={RESP_UNLOCK_EMPTY}
                  />
                </>
              }
            />

            {/* POST reveal-emails */}
            <Endpoint
              id="post-v1-events-idorslug-reveal-emails"
              method="POST"
              path="/v1/events/{idOrSlug}/reveal-emails"
              spends
              summary="Reveals verified emails for contacts you own that do not have their email tier unlocked yet. 1 credit per email actually revealed. Scope it three ways: specific contacts, a filter object, or an empty body to reveal everything eligible on the event. Revealing the same contact again returns a 400 and charges nothing."
              left={
                <ParamBlock
                  title="Body Parameters"
                  params={[
                    { name: "contact_ids", type: "array", tag: "optional", description: "Specific contact UUIDs." },
                    { name: "filters", type: "object", tag: "optional", description: "Reveal for everyone you own matching this ICP filter." },
                  ]}
                />
              }
              right={
                <>
                  <RequestPanel bash={CURL_REVEAL} js={JS_REVEAL} />
                  <CodePanel title="Example response (200)" code={RESP_REVEAL} />
                  <CodePanel
                    title="Example response (400): already revealed, nothing charged"
                    code={RESP_REVEAL_EMPTY}
                  />
                </>
              }
            />

            {/* GET event contacts */}
            <Endpoint
              id="get-v1-events-idorslug-contacts"
              method="GET"
              path="/v1/events/{idOrSlug}/contacts"
              summary="Your unlocked contacts for one event. The proof is always attached: `post_url` links the LinkedIn post where this person said they are going. `email`, `email_status`, `email_provider` are present only when `email_unlocked` is true; `has_email: true` with `email_unlocked: false` means a verified email exists and one reveal credit buys it."
              left={
                <ParamBlock
                  title="Query Parameters"
                  params={[
                    { name: "any ICP filter", description: "Narrow to matching contacts you own." },
                    { name: "sort", type: "string", tag: "optional", description: "`unlocked_at` (default), `full_name`, `current_title`, `company_name`, `post_date`, `email`." },
                    { name: "dir", type: "string", tag: "optional", description: "`asc` or `desc`." },
                    { name: "limit", type: "integer", tag: "optional", description: "Max 100." },
                    { name: "offset", type: "integer", tag: "optional", description: "Default 0." },
                  ]}
                />
              }
              right={
                <>
                  <RequestPanel bash={CURL_EVENT_CONTACTS} js={JS_EVENT_CONTACTS} />
                  <CodePanel
                    title="Example response (200): one contact shown"
                    code={RESP_EVENT_CONTACTS}
                  />
                </>
              }
            />

            {/* GET /contacts */}
            <Endpoint
              id="get-v1-contacts"
              method="GET"
              path="/v1/contacts"
              summary="Everything you own across all events, same contact payload as above plus `event_id`, `event_slug`, `event_name` on each row. With `since` it becomes the incremental sync feed (see Syncing on a schedule below)."
              left={
                <>
                  <ParamBlock
                    title="Query Parameters"
                    params={[
                      { name: "since", type: "timestamp", tag: "optional", description: "ISO 8601. Only contacts unlocked strictly after this moment, oldest first. Pass the `watermark` from your previous call, exactly as you received it. Without `since`, newest first.", example: "2026-07-19T06:49:11.503241+00:00" },
                      { name: "event", type: "string", tag: "optional", description: "Event UUID or slug to scope to one event.", example: "black-hat-usa-2026" },
                      { name: "limit", type: "integer", tag: "optional", description: "Max 200." },
                      { name: "offset", type: "integer", tag: "optional", description: "Default 0." },
                    ]}
                  />
                  <p className="mt-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    <T>
                      When many contacts were unlocked in the same instant (one bulk unlock), a page can exceed `limit` so the watermark always covers everything delivered; size your client buffers accordingly.
                    </T>
                  </p>
                </>
              }
              right={
                <>
                  <RequestPanel bash={CURL_ALL_CONTACTS} js={JS_ALL_CONTACTS} />
                  <CodePanel
                    title="Example response (200): abbreviated"
                    code={RESP_ALL_CONTACTS}
                  />
                </>
              }
            />

            {/* Syncing */}
            <SectionShell id="syncing">
              <SectionTitle>Syncing on a schedule</SectionTitle>
              <P>
                Events on WhoGoes keep growing as more people post that they are attending. There is no subscribe call and nothing runs on our side on a clock. Staying in sync is two calls that you schedule yourself (cron, n8n, Zapier, anything), and both are safe to re-run forever:
              </P>
              <ol className="mt-4 max-w-3xl list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                <li>
                  <T>
                    **Re-run your unlock, per event.** An unlock is always scoped to one event. Because you never pay twice, re-sending the exact same unlock buys only people who arrived since your last run, and spends nothing when nobody new matches. Working three events? That is three scheduled unlocks, one per event.
                  </T>
                </li>
                <li>
                  <T>
                    {"**Drain everything new with one account-wide call.** `GET /v1/contacts?since=<watermark>` returns every contact you gained since your last drain, across all events, whichever unlock bought them."}
                  </T>
                </li>
              </ol>
              <P>
                A concrete run, with your saved search being C-Suite and VP with emails on Black Hat:
              </P>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div className="space-y-4">
                  <CodePanel title="Step 1: check what a run would do (free)" code={SYNC_STEP1} />
                  <CodePanel title="Step 2: buy the newcomers" code={SYNC_STEP2} />
                </div>
                <div className="space-y-4">
                  <CodePanel title="Step 3: drain into your system" code={SYNC_STEP3} />
                </div>
              </div>
              <div className="mt-5 max-w-3xl space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <p>
                  <T>
                    Set `count` to more than you expect (500 here); you are only charged for what is actually delivered, 15 in this run. When nothing new matches, the same call returns a 400 with `"No more contacts to unlock"` and charges nothing, which is exactly what most scheduled runs will do.
                  </T>
                </p>
                <p>
                  <T>
                    Keep requesting with each response's new `watermark` until you get an empty page, then store the last watermark for the next run. The feed never duplicates and never skips.
                  </T>
                </p>
                <p>
                  <T>
                    Cost stays fully in your hands: the filter endpoint tells you before any run how many new matches exist, and a per-key daily credit cap (set in the dashboard) is a hard stop no matter what your scheduler does. Use a fresh `Idempotency-Key` per scheduled run; reusing one replays the earlier response instead of buying again, which is also your safety net for retries.
                  </T>
                </p>
              </div>
            </SectionShell>

            {/* GET /credits */}
            <Endpoint
              id="get-v1-credits"
              method="GET"
              path="/v1/credits"
              summary="Your balance and this key's daily cap state. `daily_cap` and `remaining_today` are null when the key has no cap."
              left={
                <ParamBlock
                  title="Response Fields"
                  params={[
                    { name: "balance", description: "Your current credit balance." },
                    { name: "daily_cap", description: "This key's daily spend cap, if set." },
                    { name: "spent_today", description: "Credits this key spent since UTC midnight." },
                    { name: "remaining_today", description: "What the cap still allows today." },
                  ]}
                />
              }
              right={
                <>
                  <RequestPanel bash={CURL_CREDITS} js={JS_CREDITS} />
                  <CodePanel title="Example response (200)" code={RESP_CREDITS} />
                </>
              }
            />

            {/* Rate limits */}
            <SectionShell id="rate-limits">
              <SectionTitle>Rate limits & spend caps</SectionTitle>
              <DocTable
                head={["Guardrail", "Default", "Configurable", "Window", "On exceed"]}
                rows={[
                  ["Request rate", "60 req/min per key", "No", "sliding 60 s", "429 `RATE_LIMITED`"],
                  ["Credit spend", "unlimited", "Yes, per key", "UTC day", "402 `SPEND_CAP_EXCEEDED` with `Retry-After`"],
                ]}
              />
              <div className="mt-5 grid gap-8 xl:grid-cols-2">
                <P>
                  Successful responses include `X-RateLimit-Remaining`. The 402 `Retry-After` header counts the seconds to the next UTC midnight.
                </P>
                <CodePanel title="Example response (402)" code={RESP_402} />
              </div>
            </SectionShell>

            {/* Errors */}
            <SectionShell id="errors">
              <SectionTitle>Errors</SectionTitle>
              <DocTable
                head={["Status", "Code", "Meaning"]}
                rows={[
                  ["400", "`BAD_REQUEST`", "Malformed body, invalid filter key or value, bad params"],
                  ["401", "`UNAUTHORIZED`", "Missing, invalid, or revoked API key"],
                  ["402", "`PAYMENT_REQUIRED`", "Account has never purchased credits"],
                  ["402", "`SPEND_CAP_EXCEEDED`", "Key's daily credit cap reached; see `Retry-After`"],
                  ["403", "`FORBIDDEN`", "Key valid but action not allowed"],
                  ["404", "`NOT_FOUND`", "Unknown event"],
                  ["429", "`RATE_LIMITED`", "Over 60 requests/minute"],
                  ["500", "`INTERNAL_ERROR`", "Something broke on our side; safe to retry with the same Idempotency-Key"],
                ]}
              />
              <P>
                Business outcomes that are not errors come back as 400 with `success: false` and a human-readable `message`, for example `"No more contacts to unlock"` or `"No emails to reveal"`. Nothing is ever charged on those.
              </P>
            </SectionShell>

            {/* Versioning */}
            <SectionShell id="versioning">
              <SectionTitle>Versioning & changelog</SectionTitle>
              <P>
                Additive changes (new fields, new endpoints, new filter keys) ship in `/v1` without notice; breaking changes would ship as `/v2` with at least 90 days of `/v1` support.
              </P>
              <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <li>
                  <T>
                    {"**2026-07-19**: The pre-purchase counts endpoint is now `GET /v1/events/{idOrSlug}/filter` (the old `/facets` path still works). `/v1/events` now mirrors the Browse Events page exactly: `status` filter (`active` / `completed`), every event listed, `status` field on each row, browse-page ordering, `q` matches location too, `min_contacts` param. Sync feed watermark hardened for bulk unlocks."}
                  </T>
                </li>
                <li>
                  <T>
                    **2026-07**: Initial public release. ICP filters on every surface, 2-tier pricing (identities + verified emails), single-call bundled email reveal, scheduler-friendly syncing with the incremental watermark feed.
                  </T>
                </li>
              </ul>
              <footer className="mt-10 border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                Questions? Email{" "}
                <a
                  href="mailto:hello@whogoes.co"
                  className="text-emerald-600 hover:text-emerald-500"
                >
                  hello@whogoes.co
                </a>{" "}
                and we will help you get integrated.
              </footer>
            </SectionShell>
          </main>
        </div>
      </div>
    </LangContext.Provider>
  );
}
