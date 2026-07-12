"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTheme } from "@/lib/theme-provider";
import BuyCreditsModal from "./buy-credits-modal";

interface SidebarProps {
  userEmail: string;
  credits: number;
  newLeadCount: number;
}

const NAV_ITEMS = [
  {
    href: "/dashboard",
    label: "Overview",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
        />
      </svg>
    ),
    exact: true,
  },
  {
    href: "/dashboard/events",
    label: "Browse Events",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    ),
  },
  {
    href: "/dashboard/my-events",
    label: "Unlocked Events",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>
    ),
    badge: true,
  },
  {
    href: "/dashboard/integrations",
    label: "Integrations",
    icon: (
      <svg
        className="h-5 w-5"
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
    ),
  },
  {
    href: "/dashboard/billing",
    label: "Billing",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
        />
      </svg>
    ),
  },
];

export default function Sidebar({
  userEmail,
  credits: initialCredits,
  newLeadCount,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { theme, setTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const [currentCredits, setCurrentCredits] = useState(initialCredits);

  // Desktop-only auto-collapse. Dense workspace views (the My Events contact
  // table) dispatch "sidebar-collapse" to reclaim the width; hovering the left
  // edge peeks the sidebar back in as an overlay, and pinning keeps it open.
  const [collapsed, setCollapsed] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [peek, setPeek] = useState(false);

  useEffect(() => {
    setPinnedOpen(sessionStorage.getItem("wg-sidebar-pinned") === "1");
  }, []);

  useEffect(() => {
    function handleSidebarCollapse(e: Event) {
      const wantCollapsed = Boolean(
        (e as CustomEvent<{ collapsed?: boolean }>).detail?.collapsed
      );
      setCollapsed(wantCollapsed);
      if (!wantCollapsed) setPeek(false);
    }
    window.addEventListener("sidebar-collapse", handleSidebarCollapse);
    return () =>
      window.removeEventListener("sidebar-collapse", handleSidebarCollapse);
  }, []);

  // Safety net: navigating away from the workspace restores the sidebar even
  // if the page unmounted without dispatching the expand event.
  useEffect(() => {
    if (!pathname.startsWith("/dashboard/my-events")) {
      setCollapsed(false);
      setPeek(false);
    }
  }, [pathname]);

  const isCollapsed = collapsed && !pinnedOpen;

  function setPinned(pinned: boolean) {
    setPinnedOpen(pinned);
    setPeek(false);
    try {
      sessionStorage.setItem("wg-sidebar-pinned", pinned ? "1" : "0");
    } catch {
      // Session-only preference; losing it is harmless.
    }
  }

  // Listen for external "open buy credits" events (e.g., from event detail page)
  useEffect(() => {
    function handleOpenBuyCredits() {
      setShowBuyCredits(true);
    }
    window.addEventListener("open-buy-credits", handleOpenBuyCredits);
    return () => window.removeEventListener("open-buy-credits", handleOpenBuyCredits);
  }, []);

  // Re-fetch credits when other components dispatch "credits-updated"
  useEffect(() => {
    async function handleCreditsUpdated() {
      const { data } = await supabase.rpc("get_customer_credits");
      if (data !== null) {
        setCurrentCredits(data);
      }
    }
    window.addEventListener("credits-updated", handleCreditsUpdated);
    return () => window.removeEventListener("credits-updated", handleCreditsUpdated);
  }, [supabase]);

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const renderSidebarContent = (headerAction?: ReactNode) => (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500">
          <span className="text-sm font-bold text-white">W</span>
        </div>
        <span className="flex-1 text-lg font-bold text-zinc-900 dark:text-white">WhoGoes</span>
        {headerAction}
      </div>

      {/* Navigation */}
      <nav className="mt-2 flex-1 space-y-0.5 px-3">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => {
              setMobileOpen(false);
              setPeek(false);
            }}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive(item.href, item.exact)
                ? "bg-emerald-50 text-emerald-700 dark:bg-zinc-800 dark:text-white"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-200"
            }`}
          >
            {item.icon}
            <span className="flex-1">{item.label}</span>
            {item.badge && newLeadCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-xs font-semibold text-white">
                {newLeadCount}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Credits + Theme + User */}
      <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
        {/* Low credits warning */}
        {currentCredits <= 5 && currentCredits > 0 && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Only {currentCredits} credit{currentCredits !== 1 ? "s" : ""} left
            </p>
            <button
              onClick={() => setShowBuyCredits(true)}
              className="mt-1.5 w-full cursor-pointer rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-500"
            >
              Get More Credits
            </button>
          </div>
        )}

        {currentCredits === 0 && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-xs font-medium text-red-700 dark:text-red-400">
              No credits remaining
            </p>
            <button
              onClick={() => setShowBuyCredits(true)}
              className="mt-1.5 w-full cursor-pointer rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500"
            >
              Get More Credits
            </button>
          </div>
        )}

        {/* Credits */}
        <div className="mb-3 rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Credits
            </span>
            <span className={`text-lg font-bold tabular-nums ${
              currentCredits === 0
                ? "text-red-600 dark:text-red-400"
                : currentCredits <= 5
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-zinc-900 dark:text-white"
            }`}>
              {currentCredits}
            </span>
          </div>
          {currentCredits > 5 && (
            <button
              onClick={() => setShowBuyCredits(true)}
              className="mt-2 w-full cursor-pointer rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              Buy Credits
            </button>
          )}
        </div>

        {/* Theme Toggle */}
        <div className="mb-3 flex items-center justify-between rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-800/50">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Theme</span>
          <div className="flex rounded-md bg-zinc-200 p-0.5 dark:bg-zinc-700/50">
            <button
              onClick={() => setTheme("light")}
              className={`cursor-pointer rounded px-2 py-1 text-xs font-medium transition-colors ${
                theme === "light"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white"
                  : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </button>
            <button
              onClick={() => setTheme("dark")}
              className={`cursor-pointer rounded px-2 py-1 text-xs font-medium transition-colors ${
                theme === "dark"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white"
                  : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            </button>
          </div>
        </div>

        {/* User */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            {userEmail.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{userEmail}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="cursor-pointer rounded p-1 text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
            title="Sign out"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );

  // Chevron actions in the sidebar header: pin it open from the hover peek,
  // collapse it again once pinned. Only shown while a workspace wants collapse.
  const pinOpenAction = (
    <button
      onClick={() => setPinned(true)}
      title="Keep sidebar open"
      className="cursor-pointer rounded p-1 text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
      </svg>
    </button>
  );

  const collapseAction =
    collapsed && pinnedOpen ? (
      <button
        onClick={() => setPinned(false)}
        title="Collapse sidebar"
        className="cursor-pointer rounded p-1 text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
        </svg>
      </button>
    ) : undefined;

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-30 rounded-lg bg-zinc-900 p-2 text-white shadow-lg md:hidden dark:bg-zinc-800"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 6h16M4 12h16M4 18h16"
          />
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 overflow-y-auto border-r border-zinc-200 bg-white transition-transform md:hidden dark:border-zinc-800 dark:bg-zinc-900 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {renderSidebarContent()}
      </aside>

      {/* Desktop sidebar (in flow; width animates to zero while a workspace
          view has requested collapse, giving the content the full viewport) */}
      <aside
        className={`hidden shrink-0 overflow-hidden border-zinc-200 bg-white transition-[width] duration-300 ease-in-out md:block dark:border-zinc-800 dark:bg-zinc-900 ${
          isCollapsed ? "w-0 border-r-0" : "w-64 border-r"
        }`}
      >
        <div className="h-full w-64 overflow-y-auto">
          {renderSidebarContent(collapseAction)}
        </div>
      </aside>

      {/* Collapsed-state helpers (desktop only) */}
      {isCollapsed && (
        <>
          {/* Invisible strip along the left edge: hovering it peeks the sidebar */}
          <div
            className="fixed inset-y-0 left-0 z-40 hidden w-2 md:block"
            onMouseEnter={() => setPeek(true)}
          />
          {/* Visible handle so the peek is discoverable and keyboard reachable */}
          <button
            onClick={() => setPinned(true)}
            onMouseEnter={() => setPeek(true)}
            onFocus={() => setPeek(true)}
            title="Show sidebar"
            aria-label="Show sidebar"
            className="fixed left-0 top-1/2 z-40 hidden -translate-y-1/2 cursor-pointer rounded-r-lg border border-l-0 border-zinc-200 bg-white py-3 pl-0.5 pr-1 text-zinc-400 shadow-sm transition-colors hover:text-emerald-600 md:block dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500 dark:hover:text-emerald-400"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )}

      {/* Hover peek: slides over the content while the pointer stays on it */}
      <aside
        onMouseLeave={() => setPeek(false)}
        className={`fixed inset-y-0 left-0 z-50 hidden w-64 border-r border-zinc-200 bg-white shadow-2xl transition-transform duration-300 ease-in-out md:block dark:border-zinc-800 dark:bg-zinc-900 ${
          isCollapsed && peek
            ? "translate-x-0"
            : "pointer-events-none -translate-x-full"
        }`}
      >
        <div className="h-full w-64 overflow-y-auto">
          {renderSidebarContent(pinOpenAction)}
        </div>
      </aside>

      {/* Buy Credits Modal (rendered once, outside the sidebar copies) */}
      {showBuyCredits && (
        <BuyCreditsModal
          userEmail={userEmail}
          onClose={() => setShowBuyCredits(false)}
        />
      )}
    </>
  );
}
