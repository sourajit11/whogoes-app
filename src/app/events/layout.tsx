import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function EventsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50/50 dark:bg-zinc-950">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          {user ? (
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500">
                <span className="text-sm font-bold text-white">W</span>
              </div>
              <span className="text-lg font-bold text-zinc-900 dark:text-white">
                WhoGoes
              </span>
              <span className="hidden lg:inline-block text-sm text-zinc-500 dark:text-zinc-400 border-l border-zinc-300 dark:border-zinc-700 pl-2.5 ml-0.5">
                Event Attendee Lists. With Proof.
              </span>
            </Link>
          ) : (
            <a href="https://whogoes.co" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500">
                <span className="text-sm font-bold text-white">W</span>
              </div>
              <span className="text-lg font-bold text-zinc-900 dark:text-white">
                WhoGoes
              </span>
              <span className="hidden lg:inline-block text-sm text-zinc-500 dark:text-zinc-400 border-l border-zinc-300 dark:border-zinc-700 pl-2.5 ml-0.5">
                Event Attendee Lists. With Proof.
              </span>
            </a>
          )}
          <div className="flex items-center gap-3">
            {user ? (
              <Link
                href="/dashboard"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
              >
                Go to Dashboard
              </Link>
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
