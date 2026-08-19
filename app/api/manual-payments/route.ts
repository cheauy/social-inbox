import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { getManualPaymentConfig } from "@/lib/billing/manual-payment-config";
import {
  calculatePlanTotalCents,
  calculateUpgradeTotalCents,
  getBillingCycleDefinition,
  getTrustedSubscriptionQuote,
} from "@/lib/subscription/plan-catalog";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildCustomUpgradeQuote } from "@/lib/subscription/custom-upgrade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "tenh-manual-payment-proofs";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

type ManualPaymentBody = {
  action?: unknown;
  planCode?: unknown;
  billingCycle?: unknown;
  customerNote?: unknown;
  requestId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  storagePath?: unknown;
  connections?: unknown;
  users?: unknown;
  renewSame?: unknown;
  customUpgrade?: unknown;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeFileName(value: string) {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .slice(0, 120);

  return cleaned || "payment-proof";
}

function requestDto(row: {
  id: string;
  plan_code: string;
  billing_cycle: string;
  amount: number | string;
  currency: string;
  status: string;
  proof_file_name: string;
  review_note: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  created_at: string;
}) {
  return {
    id: row.id,
    planCode: row.plan_code,
    billingCycle: row.billing_cycle,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    proofFileName: row.proof_file_name,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

async function requireOwner() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return {
      response: NextResponse.json(
        {
          success: false,
          error: authResult.error,
        },
        { status: authResult.status },
      ),
      member: null,
    };
  }

  if (authResult.member.role !== "owner") {
    return {
      response: NextResponse.json(
        {
          success: false,
          error:
            "Only the workspace owner can submit a subscription payment.",
        },
        { status: 403 },
      ),
      member: null,
    };
  }

  return {
    response: null,
    member: authResult.member,
  };
}

async function verifyManualPaymentAvailable(
  businessId: string,
) {
  const config = getManualPaymentConfig();

  if (!config.enabled) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          success: false,
          error: "Manual payment is not configured for TENH yet.",
        },
        { status: 503 },
      ),
    };
  }

  const { data: subscription, error: subscriptionError } =
    await supabaseAdmin
      .from("business_subscriptions")
      .select("id,status,plan_code,billing_cycle,last_paid_amount,last_paid_currency,member_limit,channel_limit,pricing_version,pricing_snapshot,current_period_start,current_period_end")
      .eq("business_id", businessId)
      .maybeSingle();

  if (subscriptionError) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          success: false,
          error: "Unable to load the workspace subscription.",
          details: subscriptionError.message,
        },
        { status: 500 },
      ),
    };
  }

  if (!subscription) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          success: false,
          error:
            "This workspace does not have a subscription record yet.",
        },
        { status: 409 },
      ),
    };
  }

  if (subscription.status === "suspended") {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          success: false,
          error:
            "This workspace is suspended. Contact TENH support before submitting a payment.",
        },
        { status: 403 },
      ),
    };
  }

  const { data: existingSubmitted, error: existingError } =
    await supabaseAdmin
      .from("manual_payment_requests")
      .select("id,status,created_at")
      .eq("business_id", businessId)
      .eq("status", "submitted")
      .maybeSingle();

  if (existingError) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          success: false,
          error: "Unable to check existing manual payments.",
          details: existingError.message,
        },
        { status: 500 },
      ),
    };
  }

  if (existingSubmitted) {
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          success: false,
          error:
            "A manual payment is already waiting for review. TENH must approve or reject it before another proof can be submitted.",
          requestId: existingSubmitted.id,
        },
        { status: 409 },
      ),
    };
  }

  return { ok: true as const, config, subscription };
}

type SubscriptionForQuote = {
  status: string;
  plan_code: string;
  billing_cycle: string | null;
  last_paid_amount: number | string | null;
  last_paid_currency: string | null;
  member_limit: number;
  channel_limit: number;
  pricing_version: string | null;
  pricing_snapshot: unknown;
  current_period_start: string | null;
  current_period_end: string | null;
};

function getTrustedPlan(
  planCode: string,
  billingCycle: string,
  connections: unknown,
  users: unknown,
  renewSame: boolean,
  customUpgrade: boolean,
  subscription: SubscriptionForQuote,
) {
  let quote = getTrustedSubscriptionQuote({
    planCode,
    billingCycle,
    connections,
    users,
  });

  if (customUpgrade) {
    try {
      const upgrade = buildCustomUpgradeQuote({
        subscription,
        targetConnections: connections,
        targetUsers: users,
        targetBillingCycle: billingCycle,
      });
      const cycle = getBillingCycleDefinition(billingCycle);
      if (!cycle || planCode !== "custom") return null;
      quote = {
        planCode: "custom",
        planName: "Custom Upgrade",
        channels: upgrade.targetConnections,
        users: upgrade.targetUsers,
        monthlyCents: upgrade.targetMonthlyCents,
        totalCents: upgrade.totalCents,
        pricingVersion: "v3.11.31.17",
        cycle,
      };
      return {
        plan: { id: "custom" as const, name: "Custom Upgrade", users: quote.users, channels: quote.channels },
        cycle,
        quote,
        renewSame: false,
        purchaseType: "custom-upgrade" as const,
        renewalTotalCents: upgrade.renewalTotalCents,
        upgradeFromPlanCode: subscription.plan_code,
        customUpgradeQuote: upgrade,
        amount: (upgrade.totalCents / 100).toFixed(2),
      };
    } catch {
      return null;
    }
  }

  if (renewSame) {
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
      return null;
    }

    if (planCode === "custom") {
      if (
        Number(connections) !== subscription.channel_limit ||
        Number(users) !== subscription.member_limit
      ) {
        return null;
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
      pricingVersion: subscription.pricing_version || "renew-same",
      cycle: savedCycle,
    };
  }

  if (!quote) return null;

  let purchaseType: "subscription" | "upgrade" | "renew-same" =
    renewSame ? "renew-same" : "subscription";
  let renewalTotalCents = quote.totalCents;

  const paidPeriodActive =
    subscription.status === "active" &&
    (!subscription.current_period_end ||
      new Date(subscription.current_period_end).getTime() > Date.now());

  if (!renewSame && paidPeriodActive) {
    const upgradeCharge = calculateUpgradeTotalCents(
      subscription.plan_code,
      quote.planCode,
      billingCycle,
    );

    if (upgradeCharge !== null) {
      renewalTotalCents =
        calculatePlanTotalCents(quote.planCode, billingCycle) ??
        quote.totalCents;
      quote = { ...quote, totalCents: upgradeCharge };
      purchaseType = "upgrade";
    }
  }

  return {
    plan: {
      id: quote.planCode,
      name: quote.planName,
      users: quote.users,
      channels: quote.channels,
    },
    cycle: quote.cycle,
    quote,
    renewSame,
    purchaseType,
    renewalTotalCents,
    upgradeFromPlanCode:
      purchaseType === "upgrade" ? subscription.plan_code : null,
    customUpgradeQuote: null,
    amount: (quote.totalCents / 100).toFixed(2),
  };
}

export async function GET() {
  const owner = await requireOwner();

  if (owner.response || !owner.member) {
    return owner.response;
  }

  const config = getManualPaymentConfig();

  const { data, error } = await supabaseAdmin
    .from("manual_payment_requests")
    .select(`
      id,
      plan_code,
      billing_cycle,
      amount,
      currency,
      status,
      proof_file_name,
      review_note,
      reviewed_at,
      approved_at,
      created_at
    `)
    .eq("business_id", owner.member.business_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load manual payment information.",
        details: error.message,
        hint:
          "Run supabase/07-v3-8-7-manual-payment-flow.sql first.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    config,
    request: data ? requestDto(data) : null,
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner();

  if (owner.response || !owner.member) {
    return owner.response;
  }

  let body: ManualPaymentBody;

  try {
    body = (await request.json()) as ManualPaymentBody;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "Manual payment request must be valid JSON.",
      },
      { status: 400 },
    );
  }

  const action = clean(body.action);

  if (action === "prepare-upload") {
    const availability = await verifyManualPaymentAvailable(
      owner.member.business_id,
    );

    if (!availability.ok) {
      return availability.response;
    }

    const planCode = clean(body.planCode);
    const billingCycle = clean(body.billingCycle);
    const renewSame =
      body.renewSame === true ||
      clean(body.renewSame).toLowerCase() === "true";
    const customUpgrade =
      body.customUpgrade === true ||
      clean(body.customUpgrade).toLowerCase() === "true";
    const trustedPlan = getTrustedPlan(
      planCode,
      billingCycle,
      body.connections,
      body.users,
      renewSame,
      customUpgrade,
      availability.subscription as SubscriptionForQuote,
    );
    const fileName = clean(body.fileName);
    const mimeType = clean(body.mimeType);
    const sizeBytes = Number(body.sizeBytes);

    if (!trustedPlan) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid TENH plan or billing period.",
        },
        { status: 400 },
      );
    }

    if (
      !fileName ||
      !Number.isFinite(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > MAX_FILE_SIZE ||
      !ALLOWED_MIME_TYPES.has(mimeType)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Payment proof must be JPG, PNG, WEBP, or PDF and no larger than 10 MB.",
        },
        { status: 400 },
      );
    }

    const requestId = randomUUID();
    const safeName = sanitizeFileName(fileName);
    const storagePath =
      `${owner.member.business_id}/${requestId}/` +
      `${randomUUID()}-${safeName}`;

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath, {
        upsert: false,
      });

    if (error || !data) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to prepare the payment proof upload.",
          details: error?.message,
          hint:
            "Make sure supabase/07-v3-8-7-manual-payment-flow.sql created the private proof bucket.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      requestId,
      trustedAmount: trustedPlan.amount,
      currency: "USD",
      upload: {
        bucket: BUCKET,
        path: storagePath,
        token: data.token,
      },
    });
  }

  if (action === "finalize-upload") {
    const availability = await verifyManualPaymentAvailable(
      owner.member.business_id,
    );

    if (!availability.ok) {
      return availability.response;
    }

    const requestId = clean(body.requestId);
    const planCode = clean(body.planCode);
    const billingCycle = clean(body.billingCycle);
    const renewSame =
      body.renewSame === true ||
      clean(body.renewSame).toLowerCase() === "true";
    const customUpgrade =
      body.customUpgrade === true ||
      clean(body.customUpgrade).toLowerCase() === "true";
    const trustedPlan = getTrustedPlan(
      planCode,
      billingCycle,
      body.connections,
      body.users,
      renewSame,
      customUpgrade,
      availability.subscription as SubscriptionForQuote,
    );
    const fileName = clean(body.fileName);
    const mimeType = clean(body.mimeType);
    const sizeBytes = Number(body.sizeBytes);
    const storagePath = clean(body.storagePath);
    const customerNote = clean(body.customerNote).slice(0, 1000);

    if (!requestId || !trustedPlan) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid manual payment request.",
        },
        { status: 400 },
      );
    }

    const expectedPrefix =
      `${owner.member.business_id}/${requestId}/`;

    if (
      !storagePath.startsWith(expectedPrefix) ||
      !fileName ||
      !Number.isFinite(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > MAX_FILE_SIZE ||
      !ALLOWED_MIME_TYPES.has(mimeType)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid payment proof metadata.",
        },
        { status: 400 },
      );
    }

    /*
     * Confirm the object actually exists before recording the request.
     * The bucket is private and the signed upload token only authorized this
     * exact path; TENH still verifies the path is business/request scoped.
     */
    const { data: proofObjects, error: listError } =
      await supabaseAdmin.storage
        .from(BUCKET)
        .list(`${owner.member.business_id}/${requestId}`, {
          limit: 100,
        });

    const uploadedObjectName = storagePath.split("/").pop() ?? "";
    const proofExists =
      !listError &&
      (proofObjects ?? []).some(
        (item) => item.name === uploadedObjectName,
      );

    if (!proofExists) {
      return NextResponse.json(
        {
          success: false,
          error:
            "TENH could not confirm the uploaded payment proof. Upload the receipt again.",
          details: listError?.message,
        },
        { status: 400 },
      );
    }

    const { data: inserted, error: insertError } =
      await supabaseAdmin
        .from("manual_payment_requests")
        .insert({
          id: requestId,
          business_id: owner.member.business_id,
          requested_by_member_id: owner.member.id,
          plan_code: trustedPlan.plan.id,
          billing_cycle: trustedPlan.cycle.id,
          target_member_limit: trustedPlan.quote.users,
          target_channel_limit: trustedPlan.quote.channels,
          pricing_version: trustedPlan.quote.pricingVersion,
          renew_same: trustedPlan.renewSame,
          pricing_snapshot: {
            monthly_cents: trustedPlan.quote.monthlyCents,
            total_cents: trustedPlan.quote.totalCents,
            renewal_total_cents: trustedPlan.renewalTotalCents,
            purchase_type: trustedPlan.purchaseType,
            custom_upgrade: trustedPlan.purchaseType === "custom-upgrade",
            current_billing_cycle: trustedPlan.customUpgradeQuote?.currentBillingCycle ?? null,
            target_billing_cycle: trustedPlan.customUpgradeQuote?.targetBillingCycle ?? null,
            remaining_days: trustedPlan.customUpgradeQuote?.remainingDays ?? null,
            capacity_proration_cents: trustedPlan.customUpgradeQuote?.capacityProrationCents ?? null,
            extension_months: trustedPlan.customUpgradeQuote?.extensionMonths ?? null,
            duration_extension_cents: trustedPlan.customUpgradeQuote?.durationExtensionCents ?? null,
            current_period_end: trustedPlan.customUpgradeQuote?.currentPeriodEnd ?? null,
            new_period_end: trustedPlan.customUpgradeQuote?.newPeriodEnd ?? null,
            upgrade_from_plan_code: trustedPlan.upgradeFromPlanCode,
            upgrade_charge_cents:
              trustedPlan.purchaseType === "upgrade"
                ? trustedPlan.quote.totalCents
                : null,
            member_limit: trustedPlan.quote.users,
            channel_limit: trustedPlan.quote.channels,
            cycle: trustedPlan.quote.cycle.id,
            cycle_months: trustedPlan.quote.cycle.months,
            cycle_discount: trustedPlan.quote.cycle.discount,
            renew_same: trustedPlan.renewSame,
          },
          amount: trustedPlan.amount,
          currency: "USD",
          status: "submitted",
          transfer_reference: null,
          customer_note: customerNote || null,
          proof_bucket: BUCKET,
          proof_path: storagePath,
          proof_file_name: fileName.slice(0, 255),
          proof_mime_type: mimeType,
          proof_size_bytes: Math.trunc(sizeBytes),
        })
        .select(`
          id,
          plan_code,
          billing_cycle,
          amount,
          currency,
          status,
              proof_file_name,
          review_note,
          reviewed_at,
          approved_at,
          created_at
        `)
        .single();

    if (insertError || !inserted) {
      await supabaseAdmin.storage
        .from(BUCKET)
        .remove([storagePath]);

      return NextResponse.json(
        {
          success: false,
          error:
            "The proof uploaded, but TENH could not create the manual payment request.",
          details: insertError?.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message:
        "Payment proof submitted. TENH will activate the plan only after a billing administrator verifies the transfer.",
      request: requestDto(inserted),
    });
  }

  return NextResponse.json(
    {
      success: false,
      error: "Unsupported manual payment action.",
    },
    { status: 400 },
  );
}
