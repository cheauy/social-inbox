import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getManualPaymentConfig } from "@/lib/billing/manual-payment-config";
import {
  TENH_BILLING_CYCLES,
  TENH_CUSTOM_PRICING,
  TENH_PLANS,
} from "@/lib/subscription/plan-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The mobile plan picker uses the same catalog as the website. Keeping the
 * prices on the server prevents an old app build from presenting a different
 * amount from the amount the checkout endpoint will securely calculate.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized." },
      { status: 401 },
    );
  }

  return NextResponse.json(
    {
      success: true,
      plans: TENH_PLANS,
      cycles: TENH_BILLING_CYCLES,
      custom: TENH_CUSTOM_PRICING,
      manualPayment: getManualPaymentConfig(),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
