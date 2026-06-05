// E2E test for affiliate program v2 features: name-based referral codes,
// T&C acceptance, 10/day contact cap + per-affiliate override, contact expiry,
// and referred-by on the admin customers view. Creates throwaway data and
// cleans up. Run: node scripts/test-affiliate-v2.mjs  (loads /tmp/wg.env)

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync("/tmp/wg.env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra !== undefined ? "  -> " + JSON.stringify(extra) : ""}`); }
}

const SUFFIX = Date.now();
const PW = "Test!" + SUFFIX;
const created = { users: [], affiliateIds: [] };

async function createUser(tag, fullName) {
  const email = `wg-afftest2-${tag}-${SUFFIX}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PW, email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : {},
  });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  created.users.push(data.user.id);
  return { id: data.user.id, email };
}

async function makeAffiliate(userId, displayName, status = "pending") {
  const { data, error } = await admin.from("affiliates")
    .insert({ user_id: userId, display_name: displayName, status })
    .select("id").single();
  if (error) throw new Error("affiliate insert: " + error.message);
  created.affiliateIds.push(data.id);
  return data.id;
}

async function run() {
  console.log("\n=== Affiliate program v2 E2E test ===\n");

  console.log("[1] Name-based referral code + collision suffix");
  const u1 = await createUser("slug1", "Jeet Shantikari");
  const a1 = await makeAffiliate(u1.id, "Jeet Shantikari");
  const { data: appr1 } = await admin.rpc("admin_approve_affiliate", { p_affiliate_id: a1 });
  check("slug = jeet_shantikari", appr1?.referral_code === "jeet_shantikari", appr1?.referral_code);

  const u2 = await createUser("slug2", "Jeet Shantikari");
  const a2 = await makeAffiliate(u2.id, "Jeet Shantikari");
  const { data: appr2 } = await admin.rpc("admin_approve_affiliate", { p_affiliate_id: a2 });
  check("collision => jeet_shantikari_2", appr2?.referral_code === "jeet_shantikari_2", appr2?.referral_code);

  console.log("[2] Case-insensitive link match on the new slug");
  const ref1 = await createUser("reflink");
  const { data: mc } = await admin.rpc("match_affiliate_for_signup", {
    p_user_id: ref1.id, p_email: ref1.email, p_referral_code: "JEET_SHANTIKARI", // uppercase on purpose
  });
  check("uppercase ?ref matches lowercase slug", mc === a1, mc);

  console.log("[3] T&C acceptance enforced by affiliate_apply");
  const u3 = await createUser("terms");
  const userClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await userClient.auth.signInWithPassword({ email: u3.email, password: PW });
  const { data: applyNo } = await userClient.rpc("affiliate_apply", { p_display_name: "Terms Tester", p_accept_terms: false });
  check("apply rejected without accepting terms", applyNo?.success === false, applyNo);
  const { data: applyYes } = await userClient.rpc("affiliate_apply", { p_display_name: "Terms Tester", p_accept_terms: true });
  check("apply succeeds when terms accepted", applyYes?.success === true, applyYes);
  const { data: termsRow } = await admin.from("affiliates").select("terms_accepted_at, terms_version").eq("user_id", u3.id).single();
  created.affiliateIds.push((await admin.from("affiliates").select("id").eq("user_id", u3.id).single()).data.id);
  check("terms_accepted_at recorded", !!termsRow?.terms_accepted_at && termsRow.terms_version === "2026-06", termsRow);

  console.log("[4] 10/day contact cap + per-affiliate override");
  // Sign in as affiliate a1's user and add 12 emails -> capped at 10
  const aff1Client = createClient(URL, ANON, { auth: { persistSession: false } });
  await aff1Client.auth.signInWithPassword({ email: u1.email, password: PW });
  const batch = Array.from({ length: 12 }, (_, i) => `cap-${i}-${SUFFIX}@example.com`);
  const { data: cap1 } = await aff1Client.rpc("affiliate_add_contacts", { p_emails: batch });
  check("only 10 added (daily cap)", cap1?.added === 10, cap1);
  check("capped flag true", cap1?.capped === true, cap1);
  check("daily_limit reported as 10", cap1?.daily_limit === 10, cap1);
  // Raise limit to 20, add more
  await admin.rpc("admin_set_contact_limit", { p_affiliate_id: a1, p_limit: 20 });
  const batch2 = Array.from({ length: 12 }, (_, i) => `cap2-${i}-${SUFFIX}@example.com`);
  const { data: cap2 } = await aff1Client.rpc("affiliate_add_contacts", { p_emails: batch2 });
  check("after raise to 20, 10 more added", cap2?.added === 10, cap2);

  console.log("[5] Expire stale unmatched contacts");
  await admin.from("affiliate_contacts").insert({
    affiliate_id: a1, email_normalized: `stale-${SUFFIX}@example.com`, email_original: `stale-${SUFFIX}@example.com`,
    added_at: new Date(Date.now() - 40 * 864e5).toISOString(),
  });
  await admin.rpc("expire_old_affiliate_contacts");
  const { data: stale } = await admin.from("affiliate_contacts").select("status").eq("affiliate_id", a1).eq("email_normalized", `stale-${SUFFIX}@example.com`).single();
  check("40-day-old pending contact expired", stale?.status === "expired", stale);

  console.log("[6] Referred-by surfaced on admin_customer_overview");
  // ref1 was attributed to a1 via link in [2]
  const { data: ov } = await admin.from("admin_customer_overview")
    .select("referred_by_email, referred_by_code, referral_source").eq("user_id", ref1.id).maybeSingle();
  check("referred_by_email = affiliate email", ov?.referred_by_email === u1.email, ov);
  check("referral_source = link", ov?.referral_source === "link", ov?.referral_source);
}

async function cleanup() {
  console.log("\n[cleanup] removing test data...");
  try {
    for (const id of created.affiliateIds) {
      await admin.from("affiliates").delete().eq("id", id);
    }
    for (const uid of created.users) {
      await admin.from("payments").delete().eq("user_id", uid);
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
    console.log("[cleanup] done");
  } catch (e) {
    console.log("[cleanup] WARNING:", e.message);
  }
}

try { await run(); }
catch (e) { failed++; console.log("\nFATAL:", e.message); }
finally { await cleanup(); }

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
