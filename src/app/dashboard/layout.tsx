import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Sidebar from "./components/sidebar";
import Link from "next/link";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If not authenticated, show public layout (minimal header).
  // The middleware already blocks non-public routes, so if we get here
  // without a user, they must be on a public event page.
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col bg-zinc-50/50 dark:bg-zinc-950">
        <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
            <a href="https://whogoes.co" className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500">
                <span className="text-sm font-bold text-white">W</span>
              </div>
              <span className="text-lg font-bold text-zinc-900 dark:text-white">
                WhoGoes
              </span>
            </a>
            <div className="flex items-center gap-3">
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
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  // Authenticated layout: full sidebar
  const { data: credits } = await supabase.rpc("get_customer_credits");

  const { data: subscribedEvents } = await supabase.rpc(
    "get_subscribed_events"
  );
  const totalNewLeads =
    subscribedEvents?.reduce(
      (sum: number, e: { new_contacts: number }) => sum + e.new_contacts,
      0
    ) ?? 0;

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50/50 dark:bg-zinc-950">
      <Sidebar
        userEmail={user.email ?? ""}
        credits={credits ?? 20}
        newLeadCount={totalNewLeads}
      />
      <main className="relative flex-1 overflow-y-auto">
        <div className="pointer-events-none sticky top-0 z-30 flex justify-end px-6 py-4">
          <a
            href="https://calendly.com/hello-whogoes/30min"
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 hover:shadow-md active:scale-[0.98]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Talk to Expert
          </a>
        </div>
        {children}
      </main>
    </div>
  );
}
