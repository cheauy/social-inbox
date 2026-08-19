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
  calculateUpgradeTotalCents,
  getBillingCycleDefinition,
  getTrustedSubscriptionQuote,
} from "@/lib/subscription/plan-catalog";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";
import { buildCustomUpgradeQuote, type CustomUpgradeQuote } from "@/lib/subscription/custom-upgrade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutBody = {
  planCode?: unknown;
  billingCycle?: unknown;
  paymentMethod?: unknown;
  connections?: unknown;
  users?: unknown;
  renewSame?: unknown;
  customUpgrade?: unknown;
  purchaseBusinessId?: unknown;
};

function cleanString(
  value: unknown,
): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function getBrowserReturnBaseUrl(
  request: Request,
  configuredAppUrl: string,
  environment: "sandbox" | "production",
) {
  /*
   * Production must always return to TENH_APP_URL.
   *
   * In sandbox/local testing only, allow PayWay's browser redirect to return
   * to the exact localhost origin that started checkout. This changes only
   * browser return/cancel URLs; the server callback still uses the configured
   * public callback URL.
   */
  if (environment !== "sandbox") {
    return configuredAppUrl;
  }

  try {
    const requestUrl = new URL(request.url);
    const hostname = requestUrl.hostname.toLowerCase();
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1";

    if (isLocalhost) {
      return requestUrl.origin;
    }
  } catch {
    // Fall through to the configured TENH app URL.
  }

  return configuredAppUrl;
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

    const requestedPurchaseBusinessId = cleanString(body.purchaseBusinessId);
    let billingMember = member;

    if (
      requestedPurchaseBusinessId &&
      requestedPurchaseBusinessId !== member.business_id
    ) {
      const { data: purchaseMember, error: purchaseMemberError } = await supabaseAdmin
        .from("team_members")
        .select("id,user_id,business_id,full_name,email,role,profile_picture_url,is_active")
        .eq("business_id", requestedPurchaseBusinessId)
        .eq("user_id", authResult.user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (purchaseMemberError || !purchaseMember || purchaseMember.role !== "owner") {
        return NextResponse.json(
          { success: false, error: "You do not have Owner access to this purchase workspace." },
          { status: 403 },
        );
      }

      billingMember = purchaseMember as typeof member;
    }

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

    const {
      data: subscription,
      error: subscriptionError,
    } = await supabaseAdmin
      .from("business_subscriptions")
      .select(
        "id,business_id,status,plan_code,billing_cycle,last_paid_amount,last_paid_currency,member_limit,channel_limit,pricing_version,pricing_snapshot,current_period_start,current_period_end",
      )
      .eq(
        "business_id",
        billingMember.business_id,
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

    const requestedRenewSame =
      body.renewSame === true ||
      cleanString(body.renewSame).toLowerCase() === "true";
    const requestedCustomUpgrade =
      body.customUpgrade === true ||
      cleanString(body.customUpgrade).toLowerCase() === "true";
    let customUpgradeQuote: CustomUpgradeQuote | null = null;

    let quote = getTrustedSubscriptionQuote({
      planCode,
      billingCycle,
      connections: body.connections,
      users: body.users,
    });

    if (requestedCustomUpgrade) {
      if (planCode !== "custom" || requestedRenewSame) {
        return NextResponse.json({ success: false, error: "Invalid Custom Upgrade payment request." }, { status: 400 });
      }
      try {
        customUpgradeQuote = buildCustomUpgradeQuote({
          subscription,
          targetConnections: body.connections,
          targetUsers: body.users,
          targetBillingCycle: billingCycle,
        });
      } catch (reason) {
        return NextResponse.json({ success: false, error: reason instanceof Error ? reason.message : "Unable to calculate Custom Upgrade." }, { status: 409 });
      }
      const cycleDef = getBillingCycleDefinition(billingCycle)!;
      quote = {
        planCode: "custom",
        planName: "Custom Upgrade",
        channels: customUpgradeQuote.targetConnections,
        users: customUpgradeQuote.targetUsers,
        monthlyCents: customUpgradeQuote.targetMonthlyCents,
        totalCents: customUpgradeQuote.totalCents,
        pricingVersion: "v3.11.31.17",
        cycle: cycleDef,
      };
    }

    if (requestedRenewSame) {
      const previousSnapshot =
        subscription.pricing_snapshot &&
        typeof subscription.pricing_snapshot === "object" &&
        !Array.isArray(subscription.pricing_snapshot)
          ? (subscription.pricing_snapshot as Record<string, unknown>)
          : {};
      const savedRenewalCents = Number(
        previousSnapshot.renewal_total_cents,
      );
      const savedAmount =
        Number.isFinite(savedRenewalCents) && savedRenewalCents > 0
          ? savedRenewalCents / 100
          : Number(subscription.last_paid_amount);
      const savedCycle = getBillingCycleDefinition(
        subscription.billing_cycle ?? "",
      );
      const eligibleStatus =
        subscription.status === "expired" ||
        subscription.status === "past_due" ||
        subscription.status === "cancelled";

      if (
        !eligibleStatus ||
        subscription.plan_code !== planCode ||
        subscription.billing_cycle !== billingCycle ||
        !savedCycle ||
        !Number.isFinite(savedAmount) ||
        savedAmount <= 0
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "This subscription is not eligible for exact same-subscription reactivation.",
          },
          { status: 409 },
        );
      }

      if (planCode === "custom") {
        const requestedConnections = Number(body.connections);
        const requestedUsers = Number(body.users);

        if (
          requestedConnections !== subscription.channel_limit ||
          requestedUsers !== subscription.member_limit
        ) {
          return NextResponse.json(
            {
              success: false,
              error:
                "Reactivate Same Subscription must keep the previous connection and user limits.",
            },
            { status: 409 },
          );
        }
      }

      const previousMonthly = Number(previousSnapshot.monthly_cents);

      quote = {
        planCode: planCode as "mini" | "standard" | "pro" | "custom",
        planName:
          planCode === "custom"
            ? "Custom"
            : planCode.charAt(0).toUpperCase() + planCode.slice(1),
        channels: subscription.channel_limit,
        users: subscription.member_limit,
        monthlyCents:
          Number.isFinite(previousMonthly) && previousMonthly > 0
            ? Math.round(previousMonthly)
            : Math.round(savedAmount * 100),
        totalCents: Math.round(savedAmount * 100),
        pricingVersion:
          subscription.pricing_version || "renew-same",
        cycle: savedCycle,
      };
    }

    let purchaseType: "subscription" | "upgrade" | "renew-same" | "custom-upgrade" =
      requestedCustomUpgrade ? "custom-upgrade" : requestedRenewSame ? "renew-same" : "subscription";
    let renewalTotalCents = customUpgradeQuote?.renewalTotalCents ?? quote?.totalCents ?? null;

    const paidPeriodActive =
      subscription.status === "active" &&
      (!subscription.current_period_end ||
        new Date(subscription.current_period_end).getTime() > Date.now());

    if (
      quote &&
      !requestedRenewSame &&
      !requestedCustomUpgrade &&
      paidPeriodActive
    ) {
      const upgradeCharge = calculateUpgradeTotalCents(
        subscription.plan_code,
        quote.planCode,
        billingCycle,
      );

      if (upgradeCharge !== null) {
        renewalTotalCents = calculatePlanTotalCents(
          quote.planCode,
          billingCycle,
        );
        quote = {
          ...quote,
          totalCents: upgradeCharge,
        };
        purchaseType = "upgrade";
      }
    }

    if (!quote) {
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

    const plan = {
      id: quote.planCode,
      name: quote.planName,
      channels: quote.channels,
      users: quote.users,
    };
    const cycle = quote.cycle;
    const totalCents = quote.totalCents;

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
    } = splitName(billingMember.full_name);

    const email = (
      billingMember.email ||
      authResult.user.email ||
      ""
    )
      .trim()
      .slice(0, 100);

    const browserReturnBaseUrl =
      getBrowserReturnBaseUrl(
        request,
        config.appUrl,
        config.environment,
      );

    const cancelParams = new URLSearchParams({
      payway: "cancelled",
      tran_id: transactionId,
      plan: planCode,
      cycle: billingCycle,
    });

    if (requestedPurchaseBusinessId) {
      cancelParams.set(
        "purchase_business",
        requestedPurchaseBusinessId,
      );
    }

    if (planCode === "custom") {
      cancelParams.set("connections", String(quote.channels));
      cancelParams.set("users", String(quote.users));
      if (requestedCustomUpgrade) cancelParams.set("upgrade", "custom");
    }

    if (requestedRenewSame) cancelParams.set("renew", "same");

    // Use an existing dashboard page as PayWay's cancel target. This avoids
    // depending on a dedicated cancel API route being present in the deployed
    // build, while the page safely finalizes the cancellation server-side.
    const cancelUrl =
      `${browserReturnBaseUrl}/dashboard/subscription/payment?${cancelParams.toString()}`;

    const continueSuccessUrl =
      `${browserReturnBaseUrl}/dashboard/subscription` +
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
          billingMember.business_id,
        provider: "payway",
        provider_transaction_id:
          transactionId,
        plan_code: plan.id,
        billing_cycle: cycle.id,
        target_member_limit: quote.users,
        target_channel_limit: quote.channels,
        pricing_version: quote.pricingVersion,
        renew_same: requestedRenewSame,
        pricing_snapshot: {
          monthly_cents: quote.monthlyCents,
          total_cents: quote.totalCents,
          renewal_total_cents: renewalTotalCents ?? quote.totalCents,
          purchase_type: purchaseType,
          custom_upgrade: requestedCustomUpgrade,
          current_billing_cycle: customUpgradeQuote?.currentBillingCycle ?? null,
          target_billing_cycle: customUpgradeQuote?.targetBillingCycle ?? null,
          remaining_days: customUpgradeQuote?.remainingDays ?? null,
          capacity_proration_cents: customUpgradeQuote?.capacityProrationCents ?? null,
          extension_months: customUpgradeQuote?.extensionMonths ?? null,
          duration_extension_cents: customUpgradeQuote?.durationExtensionCents ?? null,
          current_period_end: customUpgradeQuote?.currentPeriodEnd ?? null,
          new_period_end: customUpgradeQuote?.newPeriodEnd ?? null,
          upgrade_from_plan_code:
            purchaseType === "upgrade" ? subscription.plan_code : null,
          upgrade_charge_cents:
            purchaseType === "upgrade" ? quote.totalCents : null,
          member_limit: quote.users,
          channel_limit: quote.channels,
          cycle: quote.cycle.id,
          cycle_months: quote.cycle.months,
          cycle_discount: quote.cycle.discount,
          renew_same: requestedRenewSame,
        },
        amount,
        currency: "USD",
        status: "pending",
        requested_by_member_id:
          billingMember.id,
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
          member_limit: quote.users,
          channel_limit: quote.channels,
          pricing_version: quote.pricingVersion,
          monthly_price_cents: quote.monthlyCents,
          total_price_cents: quote.totalCents,
          renewal_total_cents: renewalTotalCents ?? quote.totalCents,
          purchase_type: purchaseType,
          custom_upgrade: requestedCustomUpgrade,
          current_billing_cycle: customUpgradeQuote?.currentBillingCycle ?? null,
          target_billing_cycle: customUpgradeQuote?.targetBillingCycle ?? null,
          remaining_days: customUpgradeQuote?.remainingDays ?? null,
          capacity_proration_cents: customUpgradeQuote?.capacityProrationCents ?? null,
          extension_months: customUpgradeQuote?.extensionMonths ?? null,
          duration_extension_cents: customUpgradeQuote?.durationExtensionCents ?? null,
          current_period_end: customUpgradeQuote?.currentPeriodEnd ?? null,
          new_period_end: customUpgradeQuote?.newPeriodEnd ?? null,
          upgrade_from_plan_code:
            purchaseType === "upgrade" ? subscription.plan_code : null,
          upgrade_charge_cents:
            purchaseType === "upgrade" ? quote.totalCents : null,
          renew_same: requestedRenewSame,
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
      purchaseType,
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
