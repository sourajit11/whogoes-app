import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ApiKeyManager from "./components/api-key-manager";
import type { ApiKeyDisplay } from "@/types";

// The public API has not launched yet: the page shows the pre-launch "Coming Soon"
// state instead of the key manager. Flip this to true at launch to restore the
// full API & Integrations page below.
const API_FEATURE_LIVE = false;

export default async function IntegrationsPage() {
  if (!API_FEATURE_LIVE) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          API & Integrations
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Connect WhoGoes with your existing tools
        </p>

        <div className="mt-16 flex flex-col items-center justify-center gap-4">
          <div className="rounded-full bg-zinc-100 p-6 dark:bg-zinc-800">
            <svg
              className="h-12 w-12 text-zinc-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Coming Soon
          </h2>
          <p className="max-w-md text-center text-sm text-zinc-400">
            We&apos;re building API access and CRM integrations so you can
            connect WhoGoes directly with your sales tools. Stay tuned for
            updates.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            {["REST API", "Webhooks", "HubSpot", "Salesforce", "Zapier"].map(
              (name) => (
                <span
                  key={name}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800"
                >
                  {name}
                </span>
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: eligible } = await supabase.rpc("is_api_eligible", {
    p_user_id: user.id,
  });

  if (!eligible) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          API & Integrations
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Programmatic access to WhoGoes contact data.
        </p>

        <div className="mt-10 rounded-lg border border-blue-200 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-950">
          <h2 className="text-lg font-semibold text-blue-900 dark:text-blue-100">
            Upgrade to use the API
          </h2>
          <p className="mt-2 text-sm text-blue-800 dark:text-blue-200">
            API access is included with any paid plan. Buy credits once, then
            generate keys to fetch contacts directly into your stack.
          </p>
          <Link
            href="/dashboard/billing"
            className="mt-4 inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Buy credits
          </Link>
        </div>

        <div className="mt-8 rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          <p className="font-medium text-zinc-700 dark:text-zinc-300">
            What you get with the API:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Fetch unlocked contacts as JSON for any event you have access to</li>
            <li>Unlock new contacts via POST and have credits auto-deduct</li>
            <li>Set a daily credit cap per key to prevent runaway spend</li>
            <li>Subscribe to events and pull only NEW contacts daily via one call</li>
            <li>
              Use event slugs (e.g. <code>modex-2026</code>) or UUIDs in routes
            </li>
          </ul>
          <Link
            href="/docs/api"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
          >
            Read the API documentation →
          </Link>
        </div>
      </div>
    );
  }

  const { data: apiKeys } = await supabase
    .from("api_keys")
    .select(
      "id, name, key_prefix, is_active, daily_credit_cap, created_at, last_used_at, revoked_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            API & Integrations
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Manage API keys to access WhoGoes data programmatically.
          </p>
        </div>
        <Link
          href="/docs/api"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          API Documentation
          <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M11 4h5v5M16 4l-9 9M9 4H5a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1v-4"
            />
          </svg>
        </Link>
      </div>

      <ApiKeyManager initialKeys={(apiKeys ?? []) as ApiKeyDisplay[]} />

      <div className="mt-10 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Quick Start
        </h3>
        <pre className="mt-3 overflow-x-auto rounded bg-zinc-50 p-3 text-xs dark:bg-zinc-800">
{`# Check your credits
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  https://app.whogoes.co/api/v1/credits

# List events
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  https://app.whogoes.co/api/v1/events

# Check unlock status (slug or UUID both work)
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  https://app.whogoes.co/api/v1/events/modex-2026/status

# Unlock 10 contacts (idempotency-key prevents double-charge on retry)
curl -X POST \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"count": 10}' \\
  https://app.whogoes.co/api/v1/events/modex-2026/contacts

# Get unlocked contacts (paginated)
curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "https://app.whogoes.co/api/v1/events/modex-2026/contacts?limit=50&offset=0"`}
        </pre>
      </div>
    </div>
  );
}
