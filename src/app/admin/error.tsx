"use client";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[admin] Page error:", error);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50/50 dark:bg-zinc-950">
      <div className="mx-4 w-full max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-lg dark:border-red-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold text-red-600 dark:text-red-400">
          Admin Error
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {error.message}
        </p>
        {error.digest && (
          <p className="mt-1 font-mono text-xs text-zinc-400">
            Digest: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-500"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
