"use client";

import { useState, useEffect, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Link from "next/link";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function AffiliateRegisterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  // null = still checking session; false = anonymous; string = signed-in email
  const [signedInEmail, setSignedInEmail] = useState<string | null | false>(null);
  const router = useRouter();
  const supabase = createClient();

  // If already signed in: send existing affiliates straight to the portal,
  // otherwise offer a one-click "apply" for the logged-in account.
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setSignedInEmail(false);
        return;
      }
      const { data } = await supabase
        .from("affiliates")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        router.replace("/affiliate");
      } else {
        setSignedInEmail(user.email ?? "");
      }
    });
  }, [supabase, router]);

  async function applyAndEnter(displayName: string) {
    const { error } = await supabase.rpc("affiliate_apply", {
      p_display_name: displayName,
      p_accept_terms: true,
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.push("/affiliate");
  }

  async function handleGoogleSignIn() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/affiliate/register")}`,
      },
    });
    if (error) setError(error.message);
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const [firstName, ...rest] = name.trim().split(" ");
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name: firstName, last_name: rest.join(" ") } },
    });
    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // Fire the onboarding email sequence + affiliate attribution for the new account.
    await fetch("/api/email/signup", { method: "POST" }).catch(() => {});

    await applyAndEnter(name);
  }

  async function handleApplyExisting() {
    setError("");
    setLoading(true);
    await applyAndEnter("");
  }

  const Shell = ({ children, subtitle }: { children: React.ReactNode; subtitle: string }) => (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <div className="w-full max-w-sm space-y-8 px-4">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500">
              <span className="text-sm font-bold text-white">W</span>
            </div>
            <span className="text-lg font-bold text-zinc-900 dark:text-white">WhoGoes</span>
            <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              Affiliate
            </span>
          </div>
          <p className="mt-2 text-center text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );

  const termsCheckbox = (
    <label className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
      <input
        type="checkbox"
        checked={agreed}
        onChange={(e) => setAgreed(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
      />
      <span>
        I agree to the{" "}
        <Link href="/affiliate/terms" target="_blank" className="font-medium text-emerald-600 hover:underline">
          Affiliate Program Terms
        </Link>
        .
      </span>
    </label>
  );

  if (signedInEmail === null) {
    return <Shell subtitle="Loading..."><div /></Shell>;
  }

  // Signed-in customer without an affiliate account → one-click apply.
  if (typeof signedInEmail === "string") {
    return (
      <Shell subtitle="Apply to join the WhoGoes affiliate program">
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            You&apos;re signed in as <span className="font-medium text-zinc-900 dark:text-white">{signedInEmail}</span>. Apply with this account to start earning 30% on every referral.
          </div>
          {termsCheckbox}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button onClick={handleApplyExisting} disabled={loading || !agreed}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
            {loading ? "Submitting..." : "Apply to become an affiliate"}
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell subtitle="Apply to join the WhoGoes affiliate program">
      <div className="space-y-4">
        <button type="button" onClick={handleGoogleSignIn}
          className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800">
          <GoogleIcon className="h-5 w-5" />
          Sign up with Google
        </button>
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-200 dark:border-zinc-700" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-zinc-50 px-2 text-zinc-400 dark:bg-zinc-950">or sign up with email</span>
          </div>
        </div>
      </div>

      <form onSubmit={handleRegister} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Full name</label>
          <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            placeholder="Jane Doe" />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            placeholder="you@company.com" />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Password</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
            className="mt-1 block w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            placeholder="••••••••" />
        </div>
        {termsCheckbox}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={loading || !agreed}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
          {loading ? "Submitting..." : "Apply to become an affiliate"}
        </button>
      </form>

      <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
        Already an affiliate?{" "}
        <Link href="/affiliate/login" className="font-medium text-emerald-600 hover:underline">Sign in</Link>
      </p>
    </Shell>
  );
}

export default function AffiliateRegisterPage() {
  return (
    <Suspense>
      <AffiliateRegisterForm />
    </Suspense>
  );
}
