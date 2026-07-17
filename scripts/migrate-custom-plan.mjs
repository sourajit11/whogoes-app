#!/usr/bin/env node
// One-off: record a manual custom paid plan for a single user and migrate
// mistakenly-added free credits into paid credits, so a downloadable receipt
// shows up on /dashboard/billing.
//
// Dry run (default, no writes): node app/scripts/migrate-custom-plan.mjs
// Apply:                        node app/scripts/migrate-custom-plan.mjs --apply

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
const EMAIL = "mark.grimshaw@shopnomix.com";
const CREDITS = 5000;
const AMOUNT_USD = 150;
const PACKAGE = "custom";
const PAID_AT = "2026-05-28T12:00:00Z";
const ORDER_ID = "manual_custom_20260528_shopnomix";
const PAYMENT_ID = "manual_custom_20260528_shopnomix";

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

const { data: signup } = await sb
  .from("user_signups")
  .select("free_credits")
  .eq("user_id", userId)
  .maybeSingle();
const { data: customer } = await sb
  .from("customers")
  .select("credits_balance, total_purchased_credits, total_paid_amount, last_payment_at")
  .eq("user_id", userId)
  .maybeSingle();

const freeNow = signup?.free_credits ?? 0;
log("\nCURRENT STATE");
log(`  free_credits:            ${freeNow}`);
log(`  paid credits_balance:    ${customer?.credits_balance ?? 0}`);
log(`  total_purchased_credits: ${customer?.total_purchased_credits ?? 0}`);
log(`  total_paid_amount:       ${customer?.total_paid_amount ?? 0}`);

// He bought CREDITS (5000) at AMOUNT_USD ($150), but had already spent some while
// they sat mislabeled under free. Move whatever remains in free into paid balance
// and zero out free. The payments row still records the full purchase (5000/$150).
const moveFromFree = freeNow;
const newFree = 0;
const newPaidBalance = (customer?.credits_balance ?? 0) + moveFromFree;
const newPurchased = (customer?.total_purchased_credits ?? 0) + CREDITS;
const newPaidAmount = Number(customer?.total_paid_amount ?? 0) + AMOUNT_USD;

log("\nPLANNED CHANGES");
log(`  moving from free to paid balance: ${moveFromFree}`);
log(`  user_signups.free_credits:        ${freeNow} -> ${newFree}`);
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

// 2) move free -> paid on customers
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

// 3) remove the mistaken free credits
{
  const { error } = await sb
    .from("user_signups")
    .update({ free_credits: newFree })
    .eq("user_id", userId);
  if (error) throw error;
  log("updated user_signups (free credits)");
}

log("\nDONE. Receipt is now downloadable from /dashboard/billing.");
