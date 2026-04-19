import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { sendLoopsEvent, updateLoopsContact } from "@/lib/loops";

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json({ error: "Missing payment details" }, { status: 400 });
    }

    // Verify signature using HMAC SHA256
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      console.error("Payment signature mismatch", {
        order_id: razorpay_order_id,
        user_id: user.id,
      });
      return NextResponse.json({ error: "Payment verification failed" }, { status: 400 });
    }

    // Signature valid — complete the payment and add credits via RPC
    const { data, error: rpcError } = await supabase.rpc("complete_payment", {
      p_razorpay_order_id: razorpay_order_id,
      p_razorpay_payment_id: razorpay_payment_id,
      p_razorpay_signature: razorpay_signature,
    });

    if (rpcError) {
      console.error("Complete payment RPC error:", rpcError);
      return NextResponse.json({ error: "Failed to process payment" }, { status: 500 });
    }

    const result = data as { success: boolean; message: string; credits_added?: number; new_balance?: number };

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    // Refresh Loops contact properties with fresh credit numbers on every payment
    // (first purchase OR refill), so follow-up emails render accurate balances.
    const { count: creditsUsedTotalCount } = await supabase
      .from("customer_contact_access")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id);

    const { count: paidCount } = await supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "paid");

    const isFirstPaidPayment = paidCount === 1;

    const contactUpdate: Record<string, string | number | boolean> = {
      creditsBalance: result.new_balance ?? 0,
      creditsUsedTotal: creditsUsedTotalCount ?? 0,
    };

    if (isFirstPaidPayment) {
      const { data: paymentRow } = await supabase
        .from("payments")
        .select("package_name, credits, amount_usd")
        .eq("razorpay_payment_id", razorpay_payment_id)
        .single();

      contactUpdate.plan = paymentRow?.package_name ?? "paid";

      await updateLoopsContact(user.email!, contactUpdate).catch((err) =>
        console.error("Loops contact update failed:", err)
      );

      await sendLoopsEvent({
        email: user.email!,
        eventName: "plan_purchased",
        eventProperties: {
          planName: paymentRow?.package_name ?? "",
          creditsPurchased: paymentRow?.credits ?? 0,
          amountUsd: paymentRow?.amount_usd ?? 0,
        },
      }).catch((err) => console.error("Loops plan_purchased event failed:", err));
    } else {
      // Refill — just refresh the fresh numbers, no event fire
      await updateLoopsContact(user.email!, contactUpdate).catch((err) =>
        console.error("Loops contact update failed:", err)
      );
    }

    return NextResponse.json({
      success: true,
      credits_added: result.credits_added,
      new_balance: result.new_balance,
    });
  } catch (error) {
    console.error("Verify payment error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
