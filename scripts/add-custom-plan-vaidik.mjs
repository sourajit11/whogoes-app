#!/usr/bin/env node
// One-off: record a manual custom paid plan for vaidik@revlions.ai.
// Fresh purchase (no free-credit migration): adds 800 paid credits and a
// downloadable receipt on /dashboard/billing.
//
// Dry run (default, no writes): node app/scripts/add-custom-plan-vaidik.mjs
// Apply:                        node app/scripts/add-custom-plan-vaidik.mjs --apply

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(__dirname, "..");

const env = Object.fromEntries(
  readFileSync(join(APP_DIR, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const APPLY = process.argv.includes("--apply");

// ---- the deal ----
const EMAIL = "vaidik@revlions.ai";
const CREDITS = 800;
const AMOUNT_USD = 40;
const PACKAGE = "custom";
const PAID_AT = "2026-06-03T12:00:00Z";
const ORDER_ID = "manual_custom_20260603_revlions";
const PAYMENT_ID = "manual_custom_20260603_revlions";

function log(...a) {
  console.log(...a);
}

// ---- find user ----
async function findUserId(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 1000) return null;
    page += 1;
  }
}

const userId = await findUserId(EMAIL);
if (!userId) {
  console.error(`No auth user found for ${EMAIL}`);
  process.exit(1);
}
log(`User: ${EMAIL} -> ${userId}`);

const { data: customer } = await sb
  .from("customers")
  .select("credits_balance, total_purchased_credits, total_paid_amount, last_payment_at")
  .eq("user_id", userId)
  .maybeSingle();

log("\nCURRENT STATE");
log(`  paid credits_balance:    ${customer?.credits_balance ?? 0}`);
log(`  total_purchased_credits: ${customer?.total_purchased_credits ?? 0}`);
log(`  total_paid_amount:       ${customer?.total_paid_amount ?? 0}`);

// Guard against accidental double-apply of this exact receipt.
const { data: existingPayment } = await sb
  .from("payments")
  .select("id")
  .eq("razorpay_payment_id", PAYMENT_ID)
  .maybeSingle();
if (existingPayment) {
  console.error(`\nPayment ${PAYMENT_ID} already recorded. Aborting to avoid double credits.`);
  process.exit(1);
}

const newPaidBalance = (customer?.credits_balance ?? 0) + CREDITS;
const newPurchased = (customer?.total_purchased_credits ?? 0) + CREDITS;
const newPaidAmount = Number(customer?.total_paid_amount ?? 0) + AMOUNT_USD;

log("\nPLANNED CHANGES");
log(`  customers.credits_balance:        ${customer?.credits_balance ?? 0} -> ${newPaidBalance}`);
log(`  customers.total_purchased_credits:${customer?.total_purchased_credits ?? 0} -> ${newPurchased}`);
log(`  customers.total_paid_amount:      ${customer?.total_paid_amount ?? 0} -> ${newPaidAmount}`);
log(`  payments: insert ${PACKAGE} $${AMOUNT_USD} / ${CREDITS} cr, status=paid, paid_at=${PAID_AT}`);

if (!APPLY) {
  log("\nDRY RUN. Re-run with --apply to write.");
  process.exit(0);
}

// ---- apply ----
// 1) payments receipt row
{
  const { error } = await sb.from("payments").insert({
    user_id: userId,
    razorpay_order_id: ORDER_ID,
    razorpay_payment_id: PAYMENT_ID,
    amount_usd: AMOUNT_USD,
    amount_cents: AMOUNT_USD * 100,
    currency: "USD",
    credits: CREDITS,
    status: "paid",
    package_name: PACKAGE,
    paid_at: PAID_AT,
  });
  if (error) throw error;
  log("\ninserted payments row");
}

// 2) add paid credits on customers
{
  const { error } = await sb.from("customers").upsert(
    {
      user_id: userId,
      credits_balance: newPaidBalance,
      total_purchased_credits: newPurchased,
      total_paid_amount: newPaidAmount,
      last_payment_at: PAID_AT,
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
  log("updated customers (paid credits)");
}

log("\nDONE. Receipt is now downloadable from /dashboard/billing.");
