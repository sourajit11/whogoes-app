"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

export function ConversionTracker() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (searchParams.get("new_signup") !== "1") return;

    if (typeof window !== "undefined" && typeof window.gtag === "function") {
      window.gtag("event", "conversion", {
        send_to: "AW-18070876708/l_93CN-Dx5ccEKTk7qhD",
        value: 1.0,
        currency: "INR",
      });
    }

    // Clean up the query param from the URL without a page reload
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new_signup");
    const newUrl = params.size > 0 ? `${pathname}?${params}` : pathname;
    router.replace(newUrl);
  }, [searchParams, router, pathname]);

  return null;
}
