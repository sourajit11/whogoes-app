import { redirect } from "next/navigation";
import Link from "next/link";
import { getAffiliate } from "@/lib/affiliate";
import { createClient } from "@/lib/supabase/server";
import AffiliateSidebar from "../components/affiliate-sidebar";

export default async function AffiliatePortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const affiliate = await getAffiliate();

  // No affiliate record → send them to apply (handles the logged-in case too).
  if (!affiliate) {
    redirect("/affiliate/register");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/affiliate/login");

  // Pending / suspended affiliates don't get the dashboard yet.
  if (affiliate.status !== "active") {
    const pending = affiliate.status === "pending";
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 dark:bg-zinc-950">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500">
            <span className="text-lg font-bold text-white">W</span>
          </div>
          <h1 className="mt-5 text-xl font-bold text-zinc-900 dark:text-white">
            {pending ? "Application under review" : "Account suspended"}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {pending
              ? "Thanks for applying to the WhoGoes affiliate program. We're reviewing your application and will email you once your account is approved with your referral link."
              : "Your affiliate account is currently suspended. Reach out to hello@whogoes.co if you think this is a mistake."}
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-full bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            Back to WhoGoes
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50/50 dark:bg-zinc-950">
      <AffiliateSidebar userEmail={user.email ?? ""} />
      <main className="relative flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
