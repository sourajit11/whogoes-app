export default function MyEventsLoading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="h-8 w-44 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/50" />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="h-9 w-48 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-9 w-48 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between">
              <div className="h-5 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-5 w-16 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
            </div>
            <div className="mt-3 h-3 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="mt-4 h-4 w-40 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="mt-3 h-1.5 w-full animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-2 h-3 w-32 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
