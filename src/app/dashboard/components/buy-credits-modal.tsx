"use client";

import { useState, useEffect } from "react";

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpayResponse) => void;
  prefill: { email: string };
  theme: { color: string };
  modal: { ondismiss: () => void };
}

interface RazorpayInstance {
  open: () => void;
  on: (event: string, handler: (response: RazorpayErrorResponse) => void) => void;
}

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayErrorResponse {
  error: {
    code: string;
    description: string;
    reason: string;
  };
}

interface BuyCreditsModalProps {
  userEmail: string;
  onClose: () => void;
}

const PACKAGES = [
  {
    key: "starter",
    name: "Starter",
    credits: 200,
    price: 29,
    perContact: "$0.145",
    savings: null,
    popular: false,
  },
  {
    key: "growth",
    name: "Growth",
    credits: 750,
    price: 79,
    perContact: "$0.105",
    savings: "Save 28%",
    popular: false,
  },
  {
    key: "pro",
    name: "Pro",
    credits: 2000,
    price: 149,
    perContact: "$0.075",
    savings: "Save 48%",
    popular: true,
  },
];

type ModalState = "select" | "processing" | "success" | "error";

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load payment gateway"));
    document.body.appendChild(script);
  });
}

export default function BuyCreditsModal({ userEmail, onClose }: BuyCreditsModalProps) {
  const [state, setState] = useState<ModalState>("select");
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [creditsAdded, setCreditsAdded] = useState(0);
  const [newBalance, setNewBalance] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [scriptReady, setScriptReady] = useState(false);

  // Preload Razorpay script when modal opens
  useEffect(() => {
    loadRazorpayScript()
      .then(() => setScriptReady(true))
      .catch(() => {}); // Will handle in handleBuy
  }, []);

  async function handleBuy(packageKey: string) {
    if (state === "processing") return;

    setState("processing");
    setSelectedPackage(packageKey);
    setErrorMessage("");

    try {
      // Ensure Razorpay script is loaded
      await loadRazorpayScript();

      // Step 1: Create order on our server
      const res = await fetch("/api/payments/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: packageKey }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create order");
      }

      // Step 2: Open Razorpay checkout
      const rzp = new window.Razorpay({
        key: data.key_id,
        amount: data.amount,
        currency: data.currency,
        name: "WhoGoes",
        description: `${PACKAGES.find(p => p.key === packageKey)?.credits} Credits`,
        order_id: data.order_id,
        handler: async (response: RazorpayResponse) => {
          // Step 3: Verify payment on our server
          try {
            const verifyRes = await fetch("/api/payments/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            const verifyData = await verifyRes.json();

            if (!verifyRes.ok) {
              throw new Error(verifyData.error || "Payment verification failed");
            }

            setCreditsAdded(verifyData.credits_added);
            setNewBalance(verifyData.new_balance);
            setState("success");

            // Notify sidebar to refresh credits
            window.dispatchEvent(new CustomEvent("credits-updated"));
          } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : "Payment verification failed");
            setState("error");
          }
        },
        prefill: { email: userEmail },
        theme: { color: "#10b981" },
        modal: {
          ondismiss: () => {
            // User closed the Razorpay modal without paying
            setState("select");
            setSelectedPackage(null);
          },
        },
      });

      rzp.on("payment.failed", (response: RazorpayErrorResponse) => {
        setErrorMessage(response.error.description || "Payment failed. Please try again.");
        setState("error");
      });

      rzp.open();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }

  function handleClose() {
    if (state === "processing") return;
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={handleClose}>
      <div
        className="relative mx-4 w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl sm:p-8 dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        {state !== "processing" && (
          <button
            onClick={handleClose}
            className="absolute right-4 top-4 cursor-pointer rounded-lg p-1 text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* Package selection state */}
        {state === "select" && (
          <>
            <div className="mb-6 text-center">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Buy Credits</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                1 credit = 1 contact unlock. Credits never expire.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {PACKAGES.map((pkg) => (
                <div
                  key={pkg.key}
                  className={`relative flex flex-col rounded-xl border p-5 transition-all ${
                    pkg.popular
                      ? "border-emerald-500 bg-emerald-50/50 shadow-md dark:border-emerald-400 dark:bg-emerald-900/10"
                      : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:border-zinc-600"
                  }`}
                >
                  {pkg.popular && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-3 py-0.5 text-xs font-semibold text-white">
                      Most Popular
                    </span>
                  )}

                  {pkg.savings && (
                    <span className="mb-2 inline-block w-fit rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                      {pkg.savings}
                    </span>
                  )}

                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{pkg.name}</h3>

                  <div className="mt-2">
                    <span className="text-3xl font-bold text-zinc-900 dark:text-white">${pkg.price}</span>
                  </div>

                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {pkg.credits.toLocaleString()} credits
                  </p>

                  <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                    {pkg.perContact} per contact
                  </p>

                  <button
                    onClick={() => handleBuy(pkg.key)}
                    className={`mt-4 w-full cursor-pointer rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                      pkg.popular
                        ? "bg-emerald-600 text-white hover:bg-emerald-500"
                        : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-700 dark:hover:bg-zinc-600"
                    }`}
                  >
                    Buy {pkg.name}
                  </button>
                </div>
              ))}
            </div>

            {/* Enterprise / Custom */}
            <div className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-4 text-center dark:border-zinc-700 dark:bg-zinc-800/30">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Need more credits or custom pricing?
              </p>
              <a
                href="mailto:hello@whogoes.co"
                className="mt-1 inline-block text-sm font-semibold text-emerald-600 transition-colors hover:text-emerald-500 dark:text-emerald-400"
              >
                Reach out to us at hello@whogoes.co
              </a>
            </div>
          </>
        )}

        {/* Processing state */}
        {state === "processing" && (
          <div className="flex flex-col items-center py-12">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-emerald-500" />
            <p className="mt-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Opening payment gateway...
            </p>
          </div>
        )}

        {/* Success state */}
        {state === "success" && (
          <div className="flex flex-col items-center py-10">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
              <svg className="h-8 w-8 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="mt-4 text-lg font-bold text-zinc-900 dark:text-zinc-100">Payment Successful!</h3>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {creditsAdded.toLocaleString()} credits have been added to your account.
            </p>
            <p className="mt-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              New balance: <span className="text-emerald-600 dark:text-emerald-400">{newBalance.toLocaleString()} credits</span>
            </p>
            <button
              onClick={onClose}
              className="mt-6 cursor-pointer rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              Continue
            </button>
          </div>
        )}

        {/* Error state */}
        {state === "error" && (
          <div className="flex flex-col items-center py-10">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <svg className="h-8 w-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h3 className="mt-4 text-lg font-bold text-zinc-900 dark:text-zinc-100">Payment Failed</h3>
            <p className="mt-2 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {errorMessage || "Something went wrong. Please try again."}
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => {
                  setState("select");
                  setSelectedPackage(null);
                  setErrorMessage("");
                }}
                className="cursor-pointer rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-700 dark:hover:bg-zinc-600"
              >
                Try Again
              </button>
              <button
                onClick={onClose}
                className="cursor-pointer rounded-lg border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
