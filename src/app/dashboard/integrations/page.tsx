export default function IntegrationsPage() {
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
