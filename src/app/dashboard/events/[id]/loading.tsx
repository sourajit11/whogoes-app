export default function EventDetailLoading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="h-4 w-36 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />

      <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="h-7 w-72 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
        <div className="mt-3 flex flex-wrap gap-3">
          <div className="h-4 w-40 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-4 w-28 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
        </div>
        <div className="mt-4 flex gap-6 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <div className="h-4 w-28 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-4 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
        </div>
      </div>

      <div className="mt-6">
        <div className="h-6 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-2 h-4 w-64 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/50" />

        <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-zinc-100 bg-zinc-50/80 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
            <div className="flex gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-3 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700"
                />
              ))}
            </div>
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 border-b border-zinc-100 px-3 py-3 last:border-0 dark:border-zinc-800/50"
            >
              <div className="h-4 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-4 w-32 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-4 w-5 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-4 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-4 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              <div className="h-4 w-28 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
