import Razorpay from "razorpay";

export const CREDIT_PACKAGES = {
  starter: { name: "Starter", credits: 200, priceUsd: 29, priceCents: 2900 },
  growth: { name: "Growth", credits: 750, priceUsd: 79, priceCents: 7900 },
  pro: { name: "Pro", credits: 2000, priceUsd: 149, priceCents: 14900 },
} as const;

export type PackageKey = keyof typeof CREDIT_PACKAGES;

export function isValidPackage(key: string): key is PackageKey {
  return key in CREDIT_PACKAGES;
}

// Server-side only — do not import in client components
export function getRazorpayInstance() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
}
