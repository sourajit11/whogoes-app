"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTheme } from "@/lib/theme-provider";

interface AffiliateSidebarProps {
  userEmail: string;
}

const NAV_ITEMS = [
  {
    href: "/affiliate",
    label: "Overview",
    exact: true,
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: "/affiliate/contacts",
    label: "Add Contacts",
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
      </svg>
    ),
  },
  {
    href: "/affiliate/referrals",
    label: "Referrals",
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: "/affiliate/payouts",
    label: "Payouts",
    icon: (
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
];

export default function AffiliateSidebar({ userEmail }: AffiliateSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/affiliate/login");
  }

  const sidebarContent = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500">
          <span className="text-sm font-bold text-white">W</span>
        </div>
        <span className="text-lg font-bold text-zinc-900 dark:text-white">WhoGoes</span>
        <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          Affiliate
        </span>
      </div>

      <nav className="mt-2 flex-1 space-y-0.5 px-3">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive(item.href, item.exact)
                ? "bg-emerald-50 text-emerald-700 dark:bg-zinc-800 dark:text-white"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200"
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
        <div className="mb-3 flex items-center justify-between rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-800/50">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Theme</span>
          <div className="flex rounded-md bg-zinc-200 p-0.5 dark:bg-zinc-700/50">
            <button onClick={() => setTheme("light")}
              className={`cursor-pointer rounded px-2 py-1 text-xs font-medium transition-colors ${theme === "light" ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </button>
            <button onClick={() => setTheme("dark")}
              className={`cursor-pointer rounded px-2 py-1 text-xs font-medium transition-colors ${theme === "dark" ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
            {userEmail.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{userEmail}</p>
          </div>
          <button onClick={handleSignOut} title="Sign out"
            className="cursor-pointer rounded p-1 text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-30 rounded-lg bg-emerald-600 p-2 text-white shadow-lg md:hidden">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-zinc-200 bg-white transition-transform md:hidden dark:border-zinc-800 dark:bg-zinc-900 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {sidebarContent}
      </aside>

      <aside className="hidden w-64 shrink-0 border-r border-zinc-200 bg-white md:block dark:border-zinc-800 dark:bg-zinc-900">
        {sidebarContent}
      </aside>
    </>
  );
}
