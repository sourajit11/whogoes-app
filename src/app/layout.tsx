import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/lib/theme-provider";
import { GoogleAnalytics } from "@/components/analytics";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "WhoGoes — Trade Show & Event Attendee Lists With Proof",
    template: "%s | WhoGoes",
  },
  description:
    "Outreach-ready trade show & conference attendee lists with LinkedIn proof. Browse 1,200+ events free.",
  metadataBase: new URL("https://app.whogoes.co"),
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/apple-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "WhoGoes",
    url: "https://app.whogoes.co",
    title: "WhoGoes — Trade Show & Event Attendee Lists With Proof",
    description:
      "Outreach-ready trade show & conference attendee lists with LinkedIn proof. Browse 1,200+ events free.",
  },
  twitter: {
    card: "summary_large_image",
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || undefined,
  },
};

// Inline script to prevent flash of wrong theme
const themeScript = `
  (function() {
    var t = localStorage.getItem('whogoes-theme');
    if (t === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  })();
`;
// Default is light: no 'dark' class on <html> means light theme

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <GoogleAnalytics />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
