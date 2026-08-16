import {
  randomInt,
} from "node:crypto";

import { NextResponse } from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  getPayWayConfig,
  getPayWayReadiness,
} from "@/lib/payway/config";
import {
  assertPayWayPurchaseHashCoverage,
  createPayWayPurchaseHash,
  type PayWayPurchaseFields,
} from "@/lib/payway/purchase-hash";
import {
  calculatePlanTotalCents,
  getBillingCycleDefinition,
  getPlanDefinition,
} from "@/lib/subscription/plan-catalog";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutBody = {
  planCode?: unknown;
  billingCycle?: unknown;
  paymentMethod?: unknown;
};

function cleanString(
  value: unknown,
): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function cleanPersonName(
  value: string,
  fallback: string,
) {
  const cleaned = value
    .replace(/[^\p{L}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (cleaned || fallback).slice(0, 100);
}

function splitName(
  fullName: string,
) {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return {
      firstname: "TENH",
      lastname: "Customer",
    };
  }

  if (parts.length === 1) {
    return {
      firstname: cleanPersonName(
        parts[0],
        "TENH",
      ),
      lastname: "Customer",
    };
  }

  return {
    firstname: cleanPersonName(
      parts[0],
      "TENH",
    ),
    lastname: cleanPersonName(
      parts.slice(1).join(" "),
      "Customer",
    ),
  };
}

function formatPayWayRequestTime() {
  /*
   * Use UTC YYYYMMDDHHmmss.
   * Keeping this deterministic also makes the Purchase hash input easier
   * to compare with PayWay diagnostics.
   */
  const date = new Date();

  return [
    date.getUTCFullYear(),
    String(
      date.getUTCMonth() + 1,
    ).padStart(2, "0"),
    String(
      date.getUTCDate(),
    ).padStart(2, "0"),
    String(
      date.getUTCHours(),
    ).padStart(2, "0"),
    String(
      date.getUTCMinutes(),
    ).padStart(2, "0"),
    String(
      date.getUTCSeconds(),
    ).padStart(2, "0"),
  ].join("");
}

function createTransactionId() {
  // PayWay documents tran_id with a maximum length of 20 characters.
  return `${Date.now()}${randomInt(
    10,
    100,
  )}`;
}

function centsToPayWayAmount(
  cents: number,
) {
  return (cents / 100).toFixed(2);
}

export async function POST(
  request: Request,
) {
  try {
    const authResult =
      await getCurrentMember();

    if (!authResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: authResult.error,
        },
        {
          status: authResult.status,
        },
      );
    }

    const member = authResult.member;

    if (member.role !== "owner") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Only the workspace owner can start a subscription payment.",
        },
        {
          status: 403,
        },
      );
    }

    const body =
      (await request.json()) as CheckoutBody;

    const planCode =
      cleanString(body.planCode);
    const billingCycle =
      cleanString(body.billingCycle);
    const requestedPaymentMethod =
      cleanString(body.paymentMethod);

    if (
      requestedPaymentMethod &&
      requestedPaymentMethod !==
        "abapay_khqr"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "TENH accepts ABA Pay / KHQR for this checkout.",
        },
        {
          status: 400,
        },
      );
    }

    const plan =
      getPlanDefinition(planCode);
    const cycle =
      getBillingCycleDefinition(
        billingCycle,
      );
    const totalCents =
      calculatePlanTotalCents(
        planCode,
        billingCycle,
      );

    if (
      !plan ||
      !cycle ||
      totalCents === null
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid TENH subscription plan or billing period.",
        },
        {
          status: 400,
        },
      );
    }

    const {
      data: subscription,
      error: subscriptionError,
    } = await supabaseAdmin
      .from("business_subscriptions")
      .select(
        "id,business_id,status,plan_code",
      )
      .eq(
        "business_id",
        member.business_id,
      )
      .maybeSingle();

    if (subscriptionError) {
      console.error(
        "[TENH PayWay] Unable to load subscription:",
        subscriptionError,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to prepare subscription checkout.",
        },
        {
          status: 500,
        },
      );
    }

    if (!subscription) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This workspace does not have a self-service subscription record yet.",
        },
        {
          status: 409,
        },
      );
    }

    if (
      subscription.status ===
      "suspended"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This workspace is suspended. Contact TENH support before starting a payment.",
        },
        {
          status: 403,
        },
      );
    }

    const config =
      getPayWayConfig();
    const readiness =
      getPayWayReadiness(config);

    /*
     * V3.9 LIVE SAFETY GATE
     *
     * Installing production credentials does not immediately enable real
     * charges. Production checkout remains blocked until all diagnostics
     * pass AND PAYWAY_LIVE_ENABLED=true. Sandbox checkout is unaffected.
     */
    if (
      config.environment ===
        "production" &&
      !readiness.readyToAcceptLivePayments
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "ABA PayWay live checkout is not enabled yet.",
          liveBlockers:
            readiness.liveBlockers,
        },
        { status: 503 },
      );
    }

    const reqTime =
      formatPayWayRequestTime();
    const transactionId =
      createTransactionId();
    const amount =
      centsToPayWayAmount(
        totalCents,
      );

    const {
      firstname,
      lastname,
    } = splitName(member.full_name);

    const email = (
      member.email ||
      authResult.user.email ||
      ""
    )
      .trim()
      .slice(0, 100);

    const cancelUrl =
      `${config.appUrl}/dashboard/subscription` +
      `?payway=cancelled&tran_id=${encodeURIComponent(
        transactionId,
      )}`;

    const continueSuccessUrl =
      `${config.appUrl}/dashboard/subscription` +
      `?payway=returned&tran_id=${encodeURIComponent(
        transactionId,
      )}`;

    /*
     * V3.8.5.14 — official ABA PayWay modal / Checkout gate
     *
     * Do NOT call /purchase from the TENH server and do NOT render a TENH QR.
     * The browser creates PayWay's documented hidden merchant form and calls
     * AbaPayway.checkout(). PayWay then owns/renders the secure modal UI.
     *
     * IMPORTANT: do not send view_type here. The classic checkout2-0.js plugin
     * uses the form target/id contract from PayWay's eCommerce Checkout guide.
     */
    const fields: PayWayPurchaseFields = {
      req_time: reqTime,
      merchant_id: config.merchantId,
      tran_id: transactionId,
      firstname,
      lastname,
      email,
      type: "purchase",
      payment_option:
        "abapay_khqr",
      /*
       * Keep the legacy sandbox gate that fixed TENH's sandbox modal.
       * Do NOT post payment_gate in production until ABA PayWay documents/
       * confirms its exact Purchase signing position for the live profile.
       * This ensures every field posted in LIVE mode is covered by TENH's
       * known Purchase HMAC sequence.
       */
      ...(config.environment ===
      "sandbox"
        ? { payment_gate: "0" }
        : {}),
      amount,
      currency: "USD",
      ...(config.callbackUrl
        ? {
            return_url:
              config.callbackUrl,
          }
        : {}),
      cancel_url: cancelUrl,
      continue_success_url:
        continueSuccessUrl,
      lifetime: "5",
    };

    if (
      config.environment ===
      "production"
    ) {
      assertPayWayPurchaseHashCoverage(
        fields,
      );
    }

    const hash =
      createPayWayPurchaseHash(
        fields,
        config.apiKey,
      );

    const {
      error: transactionError,
    } = await supabaseAdmin
      .from("billing_transactions")
      .insert({
        business_id:
          member.business_id,
        provider: "payway",
        provider_transaction_id:
          transactionId,
        plan_code: plan.id,
        billing_cycle: cycle.id,
        amount,
        currency: "USD",
        status: "pending",
        requested_by_member_id:
          member.id,
        request_time: reqTime,
        metadata: {
          environment:
            config.environment,
          callback_url:
            config.callbackUrl,
          plan_name: plan.name,
          billing_cycle_label:
            cycle.label,
          months: cycle.months,
          payment_method:
            "abapay_khqr",
          provider_payment_option:
            "abapay_khqr",
          presentation_mode:
            "payway_plugin_modal",
          live_enabled:
            config.liveEnabled,
          member_limit: plan.users,
          channel_limit:
            plan.channels,
        },
      });

    if (transactionError) {
      console.error(
        "[TENH PayWay] Unable to create billing transaction:",
        transactionError,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to create the TENH billing transaction.",
          details:
            transactionError.message,
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      success: true,
      environment:
        config.environment,
      checkoutUrl:
        config.purchaseUrl,
      transactionId,
      amount,
      currency: "USD",
      paymentMethod:
        "abapay_khqr",
      paymentOption:
        "abapay_khqr",
      plan: {
        code: plan.id,
        name: plan.name,
      },
      cycle: {
        code: cycle.id,
        label: cycle.label,
        months: cycle.months,
      },
      callbackConfigured:
        Boolean(config.callbackUrl),
      presentationMode:
        "payway_plugin_modal",
      fields: {
        ...fields,
        hash,
      },
    });
  } catch (error) {
    console.error(
      "[TENH PayWay] Checkout preparation failed:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare ABA PayWay checkout.",
      },
      {
        status: 500,
      },
    );
  }
}
