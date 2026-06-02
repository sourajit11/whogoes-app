"use client";

import { useState } from "react";

// Web3Forms public access key — same key the landing page Contact form uses.
// Submissions are emailed to hello@whogoes.co.
const WEB3FORMS_KEY = "0028d206-ec62-41b9-a36d-be2e628e9761";

export default function AffiliateForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState("");
  const [promotion, setPromotion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_KEY,
          subject: "New Affiliate Application: " + name,
          from_name: name,
          email: email,
          message:
            "New affiliate application\n\n" +
            "Name: " + name + "\n" +
            "Email: " + email + "\n" +
            "Website/LinkedIn: " + (url || "Not provided") + "\n\n" +
            "How they'll promote WhoGoes:\n" + promotion,
        }),
      });
      if (!res.ok) {
        throw new Error("Something went wrong. Please email hello@whogoes.co");
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center dark:border-emerald-800 dark:bg-emerald-900/20">
        <h3 className="text-xl font-bold text-zinc-900 dark:text-white">
          Application received
        </h3>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Thanks for your interest in partnering with WhoGoes. We will review your
          application and get back to you with your affiliate link soon.
        </p>
      </div>
    );
  }

  const inputClasses =
    "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white";
  const labelClasses =
    "block text-sm font-medium text-zinc-700 dark:text-zinc-300";

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="name" className={labelClasses}>
          Full name
        </label>
        <input
          id="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClasses}
          placeholder="Jane Doe"
        />
      </div>

      <div>
        <label htmlFor="email" className={labelClasses}>
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClasses}
          placeholder="jane@example.com"
        />
      </div>

      <div>
        <label htmlFor="url" className={labelClasses}>
          Website or LinkedIn{" "}
          <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <input
          id="url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className={inputClasses}
          placeholder="https://linkedin.com/in/you"
        />
      </div>

      <div>
        <label htmlFor="promotion" className={labelClasses}>
          How will you promote WhoGoes?
        </label>
        <textarea
          id="promotion"
          required
          rows={4}
          value={promotion}
          onChange={(e) => setPromotion(e.target.value)}
          className={inputClasses}
          placeholder="Tell us about your audience and how you plan to share WhoGoes."
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-full bg-emerald-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Submitting..." : "Apply to become an affiliate"}
      </button>
    </form>
  );
}
