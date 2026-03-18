import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CREDIT_PACKAGES, isValidPackage, getRazorpayInstance } from "@/lib/razorpay";

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    console.log("[create-order] Starting...");
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    console.log("[create-order] Auth:", user?.id ? "OK" : "FAILED", authError?.message || "");

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Validate package
    const body = await request.json();
    const packageKey = body.package;
    console.log("[create-order] Package:", packageKey);

    if (!packageKey || !isValidPackage(packageKey)) {
      return NextResponse.json({ error: "Invalid package selected" }, { status: 400 });
    }

    const pkg = CREDIT_PACKAGES[packageKey];

    // Create Razorpay order
    console.log("[create-order] Creating Razorpay order...");
    const razorpay = getRazorpayInstance();
    const order = await razorpay.orders.create({
      amount: pkg.priceCents,
      currency: "USD",
      receipt: `wg_${Date.now()}`,
      notes: {
        user_id: user.id,
        user_email: user.email || "",
        package: packageKey,
        credits: String(pkg.credits),
      },
    });
    console.log("[create-order] Razorpay order created:", order.id);

    // Record the order in our database (admin client bypasses RLS)
    const adminSupabase = createAdminClient();
    const { error: insertError } = await adminSupabase.from("payments").insert({
      user_id: user.id,
      razorpay_order_id: order.id,
      amount_usd: pkg.priceUsd,
      amount_cents: pkg.priceCents,
      currency: "USD",
      credits: pkg.credits,
      package_name: packageKey,
      status: "created",
    });

    if (insertError) {
      console.error("[create-order] DB insert error:", insertError);
      return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }

    console.log("[create-order] Success! Order:", order.id);
    return NextResponse.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error("[create-order] CATCH error:", error);
    const message = error instanceof Error ? error.message : "Something went wrong";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
