import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";

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
