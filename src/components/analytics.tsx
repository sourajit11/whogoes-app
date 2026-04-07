"use client";

import Script from "next/script";

export function GoogleAnalytics() {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  const gadsId = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

  if (!gaId && !gadsId) return null;

  const scriptSrc = gaId
    ? `https://www.googletagmanager.com/gtag/js?id=${gaId}`
    : `https://www.googletagmanager.com/gtag/js?id=${gadsId}`;

  return (
    <>
      <Script src={scriptSrc} strategy="afterInteractive" />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          ${gaId ? `gtag('config', '${gaId}');` : ""}
          ${gadsId ? `gtag('config', '${gadsId}');` : ""}
        `}
      </Script>
    </>
  );
}
