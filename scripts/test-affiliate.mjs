// End-to-end test for the affiliate program against the live Supabase project.
// Creates throwaway auth users + data, exercises every RPC path, then cleans up.
// No real payments: we call the same RPC complete_payment() calls internally
// (accrue_affiliate_commission) and insert synthetic payment rows.
//
// Run: node scripts/test-affiliate.mjs   (loads creds from /tmp/wg.env)

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// --- load env -------------------------------------------------------------
const env = {};
for (const line of readFileSync("/tmp/wg.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) throw new Error("Missing Supabase env");

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

// --- tiny test framework --------------------------------------------------
let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? "  -> " + JSON.stringify(extra) : ""}`);
  }
}

const SUFFIX = Date.now();
const PW = "Test!" + SUFFIX;
const mkEmail = (tag) => `wg-afftest-${tag}-${SUFFIX}@example.com`;

const created = { users: [], affiliateId: null };

async function createUser(tag) {
  const email = mkEmail(tag);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  created.users.push(data.user.id);
  return { id: data.user.id, email };
}

async function insertPayment(userId, usd, credits) {
  const { data, error } = await admin
    .from("payments")
    .insert({
      user_id: userId,
      razorpay_order_id: `test_order_${SUFFIX}_${Math.random().toString(36).slice(2, 8)}`,
      amount_usd: usd,
      amount_cents: Math.round(usd * 100),
      credits,
      status: "paid",
      package_name: "test",
    })
    .select("id")
    .single();
  if (error) throw new Error(`insertPayment: ${error.message}`);
  return data.id;
}

async function affiliateRow(id) {
  const { data } = await admin.from("affiliates").select("*").eq("id", id).single();
  return data;
}

async function run() {
  console.log("\n=== Affiliate program E2E test ===\n");

  // --- setup: affiliate A + referred users B (email), C (link) ----------
  const A = await createUser("affiliate");
  const B = await createUser("referredEmail");
  const C = await createUser("referredLink");

  // Insert pending affiliate row for A (service role bypasses RLS)
  const { data: affIns, error: affErr } = await admin
    .from("affiliates")
    .insert({ user_id: A.id, status: "pending", display_name: "Test Affiliate" })
    .select("id")
    .single();
  if (affErr) throw new Error("affiliate insert: " + affErr.message);
  created.affiliateId = affIns.id;

  console.log("[1] Approval");
  const { data: appr } = await admin.rpc("admin_approve_affiliate", {
    p_affiliate_id: created.affiliateId,
  });
  let aff = await affiliateRow(created.affiliateId);
  check("affiliate is active", aff.status === "active");
  check("referral_code assigned (name-based slug)", !!aff.referral_code && /^[a-z0-9_]+$/.test(aff.referral_code), aff.referral_code);
  const CODE = aff.referral_code;

  console.log("[2] Email-match attribution (within 7-day window)");
  // contact added now; B signed up now -> in window
  await admin.from("affiliate_contacts").insert({
    affiliate_id: created.affiliateId,
    email_normalized: B.email.toLowerCase(),
    email_original: B.email,
  });
  const { data: m1 } = await admin.rpc("match_affiliate_for_signup", {
    p_user_id: B.id,
    p_email: B.email,
    p_referral_code: null,
  });
  check("returns affiliate id", m1 === created.affiliateId, m1);
  const { data: refB } = await admin
    .from("affiliate_referrals")
    .select("*")
    .eq("referred_user_id", B.id)
    .maybeSingle();
  check("referral row created", !!refB);
  check("source = email_match", refB?.source === "email_match");
  const { data: cB } = await admin
    .from("affiliate_contacts")
    .select("status")
    .eq("affiliate_id", created.affiliateId)
    .eq("email_normalized", B.email.toLowerCase())
    .single();
  check("contact flipped to matched", cB?.status === "matched");

  console.log("[3] Out-of-window email is NOT matched");
  const D = await createUser("outOfWindow");
  // contact added 30 days ago -> D (now) is outside +/-7d window
  await admin.from("affiliate_contacts").insert({
    affiliate_id: created.affiliateId,
    email_normalized: D.email.toLowerCase(),
    email_original: D.email,
    added_at: new Date(Date.now() - 30 * 864e5).toISOString(),
  });
  const { data: mD } = await admin.rpc("match_affiliate_for_signup", {
    p_user_id: D.id,
    p_email: D.email,
    p_referral_code: null,
  });
  check("no attribution outside window", mD === null, mD);

  console.log("[4] Self-referral is blocked");
  const { data: mSelf } = await admin.rpc("match_affiliate_for_signup", {
    p_user_id: A.id,
    p_email: A.email,
    p_referral_code: CODE,
  });
  check("self-referral returns null", mSelf === null, mSelf);

  console.log("[5] Referral-link attribution");
  const { data: mC } = await admin.rpc("match_affiliate_for_signup", {
    p_user_id: C.id,
    p_email: C.email,
    p_referral_code: CODE,
  });
  check("link attribution returns affiliate", mC === created.affiliateId, mC);
  const { data: refC } = await admin
    .from("affiliate_referrals")
    .select("source")
    .eq("referred_user_id", C.id)
    .maybeSingle();
  check("source = link", refC?.source === "link");

  console.log("[6] First-touch idempotency (re-match B is a no-op)");
  const before = (await admin.from("affiliate_referrals").select("id", { count: "exact" }).eq("referred_user_id", B.id));
  await admin.rpc("match_affiliate_for_signup", { p_user_id: B.id, p_email: B.email, p_referral_code: CODE });
  const after = (await admin.from("affiliate_referrals").select("id", { count: "exact" }).eq("referred_user_id", B.id));
  check("still exactly one referral for B", before.count === 1 && after.count === 1, { before: before.count, after: after.count });

  console.log("[7] Commission accrual (30%, lifetime, idempotent)");
  const pay1 = await insertPayment(B.id, 79, 750);
  await admin.rpc("accrue_affiliate_commission", { p_payment_id: pay1, p_user_id: B.id, p_amount_usd: 79 });
  aff = await affiliateRow(created.affiliateId);
  check("pending balance = 23.70 after $79", Number(aff.pending_balance_usd) === 23.7, aff.pending_balance_usd);
  // idempotent on payment_id
  await admin.rpc("accrue_affiliate_commission", { p_payment_id: pay1, p_user_id: B.id, p_amount_usd: 79 });
  aff = await affiliateRow(created.affiliateId);
  check("no double-accrual on retry", Number(aff.pending_balance_usd) === 23.7, aff.pending_balance_usd);
  // second purchase accrues again (forever)
  const pay2 = await insertPayment(B.id, 149, 2000);
  await admin.rpc("accrue_affiliate_commission", { p_payment_id: pay2, p_user_id: B.id, p_amount_usd: 149 });
  aff = await affiliateRow(created.affiliateId);
  check("pending balance = 68.40 after 2nd purchase", Number(aff.pending_balance_usd) === 68.4, aff.pending_balance_usd);
  check("total_earned tracks lifetime", Number(aff.total_earned_usd) === 68.4, aff.total_earned_usd);

  console.log("[8] Affiliate-facing RPCs run with the affiliate's own session");
  const userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: signErr } = await userClient.auth.signInWithPassword({ email: A.email, password: PW });
  check("affiliate can sign in", !signErr, signErr?.message);

  // add contacts: a new prospect, the affiliate's own email (skipped), a dup
  const prospect = mkEmail("prospect");
  const { data: addRes } = await userClient.rpc("affiliate_add_contacts", {
    p_emails: [prospect, A.email, prospect],
  });
  check("add_contacts added 1 (dedup + self skipped)", addRes?.added === 1, addRes);

  const { data: dash } = await userClient.rpc("affiliate_get_dashboard");
  check("dashboard status active", dash?.status === "active");
  check("dashboard pending balance correct", Number(dash?.pending_balance_usd) === 68.4, dash?.pending_balance_usd);
  check("dashboard shows 2 referrals", dash?.signups === 2, dash?.signups);
  const emailRef = (dash?.referrals ?? []).find((r) => r.source === "email_match");
  const linkRef = (dash?.referrals ?? []).find((r) => r.source === "link");
  check("submitted email shown in full", emailRef?.email === B.email, emailRef?.email);
  check("link signup email masked", typeof linkRef?.email === "string" && linkRef.email.includes("****"), linkRef?.email);

  // payout details
  const { data: payoutRes } = await userClient.rpc("affiliate_update_payout", {
    p_method: "paypal",
    p_details: { info: "test@paypal.com" },
  });
  check("update payout details ok", payoutRes?.success === true, payoutRes);

  console.log("[9] Payout ledger");
  const { data: payout } = await admin.rpc("admin_mark_payout_paid", {
    p_affiliate_id: created.affiliateId,
    p_method: "paypal",
    p_reference: "TESTTXN",
  });
  check("payout amount = 68.40", Number(payout?.amount_usd) === 68.4, payout);
  aff = await affiliateRow(created.affiliateId);
  check("pending reset to 0", Number(aff.pending_balance_usd) === 0, aff.pending_balance_usd);
  check("paid balance = 68.40", Number(aff.paid_balance_usd) === 68.4, aff.paid_balance_usd);
  const { data: paidComms } = await admin
    .from("affiliate_commissions")
    .select("status")
    .eq("affiliate_id", created.affiliateId);
  check("all commissions marked paid", paidComms.every((c) => c.status === "paid"), paidComms);

  console.log("[10] Void a commission reverses the balance");
  const pay3 = await insertPayment(B.id, 29, 200);
  await admin.rpc("accrue_affiliate_commission", { p_payment_id: pay3, p_user_id: B.id, p_amount_usd: 29 });
  aff = await affiliateRow(created.affiliateId);
  check("pending = 8.70 after new purchase", Number(aff.pending_balance_usd) === 8.7, aff.pending_balance_usd);
  const { data: pendComm } = await admin
    .from("affiliate_commissions")
    .select("id")
    .eq("affiliate_id", created.affiliateId)
    .eq("status", "pending")
    .single();
  await admin.rpc("admin_void_commission", { p_commission_id: pendComm.id });
  aff = await affiliateRow(created.affiliateId);
  check("pending back to 0 after void", Number(aff.pending_balance_usd) === 0, aff.pending_balance_usd);

  console.log("[11] Admin detail RPC");
  const { data: detail } = await admin.rpc("admin_get_affiliate_detail", {
    p_affiliate_id: created.affiliateId,
  });
  check("detail returns affiliate", detail?.affiliate?.id === created.affiliateId);
  check("detail lists referrals", Array.isArray(detail?.referrals) && detail.referrals.length === 2, detail?.referrals?.length);
  check("detail lists payouts", Array.isArray(detail?.payouts) && detail.payouts.length === 1, detail?.payouts?.length);
}

async function cleanup() {
  console.log("\n[cleanup] removing test data...");
  try {
    if (created.affiliateId) {
      // affiliate cascade removes contacts/referrals/commissions/payouts
      await admin.from("affiliates").delete().eq("id", created.affiliateId);
    }
    for (const uid of created.users) {
      await admin.from("payments").delete().eq("user_id", uid);
    }
    for (const uid of created.users) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    console.log("[cleanup] done");
  } catch (e) {
    console.log("[cleanup] WARNING:", e.message);
  }
}

try {
  await run();
} catch (e) {
  failed++;
  console.log("\nFATAL:", e.message);
} finally {
  await cleanup();
}

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
