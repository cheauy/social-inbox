import { NextResponse } from "next/server";

import {
  getTenhAdminMutationUser,
  getTenhAdminUser,
} from "@/lib/admin/tenh-admin-auth";
import { logTenhAdminAction } from "@/lib/admin/log-tenh-admin-action";
import { getManualPaymentPayWaySafety } from "@/lib/billing/manual-payment-payway-safety";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function noStoreJson(
  body: unknown,
  init?: { status?: number },
) {
  return NextResponse.json(body, {
    status: init?.status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}

function formatAmount(
  amount: number | string,
  currency: string,
) {
  const numeric = Number(amount);

  if (!Number.isFinite(numeric)) {
    return `${amount} ${currency}`;
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${currency}`;
  }
}

function billingCycleLabel(value: string) {
  if (value === "monthly") return "monthly";
  if (value === "3-months") return "3-month";
  if (value === "6-months") return "6-month";
  if (value === "12-months") return "12-month";
  return value;
}

type ManualPaymentNotificationInput = {
  payment: {
    id: string;
    business_id: string;
    requested_by_member_id: string | null;
    plan_code: string;
    billing_cycle: string;
    amount: number | string;
    currency: string;
  };
  decision: "approved" | "rejected";
  reviewNote: string;
};

/**
 * Payment status is the source of truth. Bell delivery is intentionally
 * best-effort so a temporary notification failure can never undo an approved
 * subscription or change the review decision.
 */
async function sendManualPaymentNotification({
  payment,
  decision,
  reviewNote,
}: ManualPaymentNotificationInput) {
  if (!payment.requested_by_member_id) {
    return {
      sent: false,
      warning:
        "The original submitting member is no longer attached to this request, so no bell notification was created.",
    };
  }

  const amountLabel = formatAmount(
    payment.amount,
    payment.currency,
  );
  const planLabel = payment.plan_code.toUpperCase();
  const cycleLabel = billingCycleLabel(payment.billing_cycle);

  const title =
    decision === "approved"
      ? "Manual payment approved"
      : "Manual payment needs attention";

  const baseBody =
    decision === "approved"
      ? `Your ${planLabel} ${cycleLabel} payment of ${amountLabel} was approved. Your TENH subscription is active.`
      : `Your ${planLabel} ${cycleLabel} payment of ${amountLabel} was not approved.`;

  const body = reviewNote
    ? `${baseBody} TENH review note: ${reviewNote}`
    : baseBody;

  const { error } = await supabaseAdmin
    .from("team_notifications")
    .insert({
      business_id: payment.business_id,
      recipient_member_id: payment.requested_by_member_id,
      actor_member_id: null,
      notification_type: `manual_payment_${decision}`,
      title,
      body: body.slice(0, 1500),
      link: "/dashboard/subscription",
      room_id: null,
      conversation_id: null,
      contact_id: null,
      is_read: false,
      read_at: null,
    });

  if (error) {
    console.error(
      "[TENH V3.8.8.7] Manual payment decision saved, but customer notification failed:",
      error,
    );

    return {
      sent: false,
      warning:
        "The payment decision was saved, but the customer bell notification could not be created.",
    };
  }

  return {
    sent: true,
    warning: null,
  };
}

function snapshotObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function purchaseTypeFromSnapshot(
  snapshot: unknown,
  renewSame: boolean,
) {
  const value = clean(snapshotObject(snapshot).purchase_type);

  if (
    value === "upgrade" ||
    value === "custom-upgrade" ||
    value === "renew-same" ||
    value === "subscription"
  ) {
    return value;
  }

  return renewSame ? "renew-same" : "subscription";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sameMoney(left: unknown, right: unknown) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.005;
}

function safeDateMs(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

async function loadRequests() {
  const { data: rows, error } = await supabaseAdmin
    .from("manual_payment_requests")
    .select(`
      id,
      business_id,
      requested_by_member_id,
      plan_code,
      billing_cycle,
      target_member_limit,
      target_channel_limit,
      renew_same,
      pricing_snapshot,
      amount,
      currency,
      status,
      customer_note,
      proof_bucket,
      proof_path,
      proof_file_name,
      proof_mime_type,
      proof_size_bytes,
      reviewed_by_email,
      reviewed_at,
      review_note,
      approved_at,
      created_at
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(error.message);
  }

  const businessIds = Array.from(
    new Set((rows ?? []).map((row) => row.business_id)),
  );

  const requesterIds = Array.from(
    new Set(
      (rows ?? [])
        .map((row) => row.requested_by_member_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const businessMap = new Map<string, string>();
  const requesterMap = new Map<
    string,
    {
      name: string;
      email: string | null;
      role: string | null;
    }
  >();
  const subscriptionMap = new Map<string, any>();
  const activeMembersMap = new Map<string, number>();
  const activeChannelsMap = new Map<string, number>();
  const payWayMap = new Map<string, any[]>();

  if (businessIds.length > 0) {
    const [
      businessesResult,
      subscriptionsResult,
      membersResult,
      channelsResult,
      payWayResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select("id,name")
        .in("id", businessIds),
      supabaseAdmin
        .from("business_subscriptions")
        .select(
          "business_id,status,plan_code,billing_cycle,member_limit,channel_limit,current_period_start,current_period_end,payment_provider",
        )
        .in("business_id", businessIds),
      supabaseAdmin
        .from("team_members")
        .select("business_id")
        .in("business_id", businessIds)
        .eq("is_active", true),
      supabaseAdmin
        .from("social_accounts")
        .select("business_id")
        .in("business_id", businessIds)
        .eq("is_active", true),
      supabaseAdmin
        .from("billing_transactions")
        .select(
          "id,business_id,provider_transaction_id,plan_code,billing_cycle,target_member_limit,target_channel_limit,amount,currency,status,verified_at,created_at",
        )
        .in("business_id", businessIds)
        .eq("provider", "payway")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const failed = [
      businessesResult,
      subscriptionsResult,
      membersResult,
      channelsResult,
      payWayResult,
    ].find((result) => result.error);

    if (failed?.error) {
      throw new Error(failed.error.message);
    }

    for (const business of businessesResult.data ?? []) {
      businessMap.set(
        business.id,
        business.name ?? "TENH workspace",
      );
    }

    for (const subscription of subscriptionsResult.data ?? []) {
      subscriptionMap.set(subscription.business_id, subscription);
    }

    for (const member of membersResult.data ?? []) {
      activeMembersMap.set(
        member.business_id,
        (activeMembersMap.get(member.business_id) ?? 0) + 1,
      );
    }

    for (const channel of channelsResult.data ?? []) {
      activeChannelsMap.set(
        channel.business_id,
        (activeChannelsMap.get(channel.business_id) ?? 0) + 1,
      );
    }

    for (const transaction of payWayResult.data ?? []) {
      const list = payWayMap.get(transaction.business_id) ?? [];
      list.push(transaction);
      payWayMap.set(transaction.business_id, list);
    }
  }

  if (requesterIds.length > 0) {
    const { data: requesters, error: requesterError } =
      await supabaseAdmin
        .from("team_members")
        .select("id,full_name,email,role")
        .in("id", requesterIds);

    if (requesterError) {
      throw new Error(requesterError.message);
    }

    for (const requester of requesters ?? []) {
      requesterMap.set(requester.id, {
        name:
          requester.full_name?.trim() ||
          requester.email?.trim() ||
          "Workspace owner",
        email: requester.email ?? null,
        role: requester.role ?? null,
      });
    }
  }

  return Promise.all(
    (rows ?? []).map(async (row) => {
      let proofUrl: string | null = null;

      if (row.proof_bucket && row.proof_path) {
        const { data } = await supabaseAdmin.storage
          .from(row.proof_bucket)
          .createSignedUrl(row.proof_path, 10 * 60);

        proofUrl = data?.signedUrl ?? null;
      }

      const requester = row.requested_by_member_id
        ? requesterMap.get(row.requested_by_member_id)
        : null;
      const subscription = subscriptionMap.get(row.business_id) ?? null;
      const purchaseType = purchaseTypeFromSnapshot(
        row.pricing_snapshot,
        Boolean(row.renew_same),
      );
      const targetMemberLimit = numberOrNull(row.target_member_limit);
      const targetChannelLimit = numberOrNull(row.target_channel_limit);
      const rowCreatedAt = safeDateMs(row.created_at) ?? Date.now();
      const now = Date.now();
      const matchingPayWay = (payWayMap.get(row.business_id) ?? []).filter(
        (transaction) =>
          transaction.plan_code === row.plan_code &&
          transaction.billing_cycle === row.billing_cycle &&
          sameMoney(transaction.amount, row.amount) &&
          (targetMemberLimit === null ||
            numberOrNull(transaction.target_member_limit) === null ||
            numberOrNull(transaction.target_member_limit) === targetMemberLimit) &&
          (targetChannelLimit === null ||
            numberOrNull(transaction.target_channel_limit) === null ||
            numberOrNull(transaction.target_channel_limit) === targetChannelLimit),
      );

      const approvedConflict = matchingPayWay.find((transaction) => {
        if (transaction.status !== "approved") return false;
        const paidAt =
          safeDateMs(transaction.verified_at) ??
          safeDateMs(transaction.created_at);
        return (
          paidAt !== null &&
          Math.abs(rowCreatedAt - paidAt) <= 48 * 60 * 60 * 1000
        );
      });

      const pendingConflict = matchingPayWay.find((transaction) => {
        if (transaction.status !== "pending") return false;
        const createdAt = safeDateMs(transaction.created_at);
        return (
          createdAt !== null &&
          now - createdAt <= 15 * 60 * 1000
        );
      });

      const periodEnd = safeDateMs(subscription?.current_period_end);
      const activePayWaySamePurchase = Boolean(
        subscription &&
          subscription.status === "active" &&
          subscription.payment_provider === "payway" &&
          subscription.plan_code === row.plan_code &&
          subscription.billing_cycle === row.billing_cycle &&
          (periodEnd === null || periodEnd > now),
      );

      const blockingPayWay = approvedConflict ?? pendingConflict ?? null;
      const safetyBlocked =
        activePayWaySamePurchase || Boolean(blockingPayWay);
      const safetyKind = activePayWaySamePurchase || approvedConflict
        ? "approved"
        : pendingConflict
          ? "pending"
          : "clear";
      const latestPayWay = (payWayMap.get(row.business_id) ?? [])[0] ?? null;

      return {
        id: row.id,
        businessId: row.business_id,
        businessName:
          businessMap.get(row.business_id) ?? "TENH workspace",
        requestedByMemberId: row.requested_by_member_id,
        requesterName: requester?.name ?? "Workspace owner",
        requesterEmail: requester?.email ?? null,
        requesterRole: requester?.role ?? null,
        planCode: row.plan_code,
        billingCycle: row.billing_cycle,
        purchaseType,
        targetMemberLimit,
        targetChannelLimit,
        amount: Number(row.amount),
        currency: row.currency,
        status: row.status,
        customerNote: row.customer_note,
        proofFileName: row.proof_file_name,
        proofMimeType: row.proof_mime_type,
        proofSizeBytes: row.proof_size_bytes,
        proofUrl,
        reviewedByEmail: row.reviewed_by_email,
        reviewedAt: row.reviewed_at,
        reviewNote: row.review_note,
        approvedAt: row.approved_at,
        createdAt: row.created_at,
        currentSubscription: subscription
          ? {
              status: subscription.status,
              planCode: subscription.plan_code,
              billingCycle: subscription.billing_cycle,
              memberLimit: numberOrNull(subscription.member_limit),
              channelLimit: numberOrNull(subscription.channel_limit),
              currentPeriodStart: subscription.current_period_start,
              currentPeriodEnd: subscription.current_period_end,
              paymentProvider: subscription.payment_provider,
            }
          : null,
        currentUsage: {
          activeMembers: activeMembersMap.get(row.business_id) ?? 0,
          activeChannels: activeChannelsMap.get(row.business_id) ?? 0,
        },
        paymentSafety: {
          blocked: safetyBlocked,
          kind: safetyKind,
          message: safetyBlocked
            ? safetyKind === "pending"
              ? "A matching ABA PayWay checkout is still recent/pending. Do not approve manual payment until PayWay finishes or is cancelled."
              : "A matching ABA PayWay purchase is already verified/active. Do not approve this manual payment; it could charge/activate the same purchase twice."
            : "No matching recent ABA PayWay conflict detected by TENH.",
          transaction: blockingPayWay
            ? {
                transactionId: blockingPayWay.provider_transaction_id,
                status: blockingPayWay.status,
                amount: Number(blockingPayWay.amount),
                currency: blockingPayWay.currency,
                createdAt: blockingPayWay.created_at,
                verifiedAt: blockingPayWay.verified_at,
              }
            : null,
          latestPayWay: latestPayWay
            ? {
                transactionId: latestPayWay.provider_transaction_id,
                status: latestPayWay.status,
                planCode: latestPayWay.plan_code,
                billingCycle: latestPayWay.billing_cycle,
                amount: Number(latestPayWay.amount),
                currency: latestPayWay.currency,
                createdAt: latestPayWay.created_at,
                verifiedAt: latestPayWay.verified_at,
              }
            : null,
        },
      };
    }),
  );
}

export async function GET() {
  const admin = await getTenhAdminUser();

  if (!admin.success) {
    return noStoreJson(
      {
        success: false,
        error: admin.error,
      },
      { status: admin.status },
    );
  }

  try {
    const requests = await loadRequests();

    return noStoreJson({
      success: true,
      requests,
    });
  } catch (error) {
    return noStoreJson(
      {
        success: false,
        error: "Unable to load manual payment requests.",
        details:
          error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const admin = await getTenhAdminMutationUser(request);

  if (!admin.success) {
    return noStoreJson(
      {
        success: false,
        error: admin.error,
      },
      { status: admin.status },
    );
  }

  let body: {
    requestId?: unknown;
    decision?: unknown;
    reviewNote?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return noStoreJson(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      { status: 400 },
    );
  }

  const requestId = clean(body.requestId);
  const decision = clean(body.decision).toLowerCase();
  const reviewNote = clean(body.reviewNote).slice(0, 1000);

  if (!requestId || !["approve", "reject"].includes(decision)) {
    return noStoreJson(
      {
        success: false,
        error: "requestId and a valid decision are required.",
      },
      { status: 400 },
    );
  }

  if (decision === "reject" && reviewNote.length < 3) {
    return noStoreJson(
      {
        success: false,
        error:
          "Add a short review note explaining why this payment was rejected. The customer will see it.",
      },
      { status: 400 },
    );
  }

  const { data: payment, error: paymentError } =
    await supabaseAdmin
      .from("manual_payment_requests")
      .select(`
        id,
        status,
        business_id,
        requested_by_member_id,
        plan_code,
        billing_cycle,
        target_member_limit,
        target_channel_limit,
        pricing_snapshot,
        amount,
        currency,
        created_at
      `)
      .eq("id", requestId)
      .maybeSingle();

  if (paymentError) {
    return noStoreJson(
      {
        success: false,
        error: "Unable to load the manual payment request.",
        details: paymentError.message,
      },
      { status: 500 },
    );
  }

  if (!payment) {
    return noStoreJson(
      {
        success: false,
        error: "Manual payment request was not found.",
      },
      { status: 404 },
    );
  }

  if (decision === "reject") {
    if (payment.status !== "submitted") {
      return noStoreJson(
        {
          success: false,
          error: `This request is already ${payment.status}.`,
        },
        { status: 409 },
      );
    }

    const { data: rejected, error: rejectError } =
      await supabaseAdmin
        .from("manual_payment_requests")
        .update({
          status: "rejected",
          reviewed_by_user_id: admin.user.id,
          reviewed_by_email: admin.user.email ?? null,
          reviewed_at: new Date().toISOString(),
          review_note: reviewNote,
        })
        .eq("id", requestId)
        .eq("status", "submitted")
        .select("id")
        .maybeSingle();

    if (rejectError) {
      return noStoreJson(
        {
          success: false,
          error: "Unable to reject the payment request.",
          details: rejectError.message,
        },
        { status: 500 },
      );
    }

    if (!rejected) {
      return noStoreJson(
        {
          success: false,
          error:
            "This payment changed status while you were reviewing it. Refresh and check the latest result.",
        },
        { status: 409 },
      );
    }

    await logTenhAdminAction({
      user: admin.user,
      action: "manual_payment_rejected",
      resourceType: "manual_payment_request",
      resourceId: requestId,
      metadata: {
        businessId: payment.business_id,
        planCode: payment.plan_code,
        billingCycle: payment.billing_cycle,
        amount: Number(payment.amount),
        currency: payment.currency,
        reviewNote,
      },
    });

    const notification = await sendManualPaymentNotification({
      payment,
      decision: "rejected",
      reviewNote,
    });

    return noStoreJson({
      success: true,
      decision: "rejected",
      requestId,
      notificationSent: notification.sent,
      notificationWarning: notification.warning,
    });
  }

  if (payment.status === "submitted") {
    const payWaySafety = await getManualPaymentPayWaySafety({
      businessId: payment.business_id,
      planCode: payment.plan_code,
      billingCycle: payment.billing_cycle,
      amount: Number(payment.amount),
      targetMemberLimit: numberOrNull(payment.target_member_limit),
      targetChannelLimit: numberOrNull(payment.target_channel_limit),
      manualCreatedAt: payment.created_at,
    });

    if (payWaySafety.blocked) {
      return noStoreJson(
        {
          success: false,
          error: payWaySafety.message,
          code:
            payWaySafety.kind === "approved"
              ? "TENH_MANUAL_DUPLICATE_PAYWAY_APPROVED"
              : "TENH_MANUAL_PAYWAY_STILL_PENDING",
        },
        { status: 409 },
      );
    }

    const { data: currentSubscription, error: subscriptionError } =
      await supabaseAdmin
        .from("business_subscriptions")
        .select(
          "status,plan_code,billing_cycle,current_period_end,payment_provider",
        )
        .eq("business_id", payment.business_id)
        .maybeSingle();

    if (subscriptionError) {
      return noStoreJson(
        {
          success: false,
          error:
            "Unable to verify the current subscription before approval.",
          details: subscriptionError.message,
        },
        { status: 500 },
      );
    }

    const currentPeriodEnd = safeDateMs(
      currentSubscription?.current_period_end,
    );
    const activePayWaySamePurchase = Boolean(
      currentSubscription &&
        currentSubscription.status === "active" &&
        currentSubscription.payment_provider === "payway" &&
        currentSubscription.plan_code === payment.plan_code &&
        currentSubscription.billing_cycle === payment.billing_cycle &&
        (currentPeriodEnd === null || currentPeriodEnd > Date.now()),
    );

    if (activePayWaySamePurchase) {
      return noStoreJson(
        {
          success: false,
          error:
            "This subscription purchase is already active from ABA PayWay. Manual approval is blocked to prevent a duplicate activation/payment.",
          code: "TENH_MANUAL_DUPLICATE_PAYWAY_ACTIVE",
        },
        { status: 409 },
      );
    }
  }

  if (
    payment.status !== "submitted" &&
    payment.status !== "approved"
  ) {
    return noStoreJson(
      {
        success: false,
        error: `This request cannot be approved from status ${payment.status}.`,
      },
      { status: 409 },
    );
  }

  const wasAlreadyApproved = payment.status === "approved";

  const { data: activation, error: activationError } =
    await supabaseAdmin.rpc("tenh_approve_manual_payment", {
      p_request_id: requestId,
      p_reviewed_by_user_id: admin.user.id,
      p_reviewed_by_email: admin.user.email ?? null,
      p_review_note: reviewNote || null,
    });

  if (activationError) {
    return noStoreJson(
      {
        success: false,
        error: "Unable to activate the subscription.",
        details: activationError.message,
      },
      { status: 500 },
    );
  }

  await logTenhAdminAction({
    user: admin.user,
    action: wasAlreadyApproved
      ? "manual_payment_approval_rechecked"
      : "manual_payment_approved",
    resourceType: "manual_payment_request",
    resourceId: requestId,
    metadata: {
      businessId: payment.business_id,
      planCode: payment.plan_code,
      billingCycle: payment.billing_cycle,
      amount: Number(payment.amount),
      currency: payment.currency,
      reviewNote: reviewNote || null,
      wasAlreadyApproved,
    },
  });

  const notification = wasAlreadyApproved
    ? {
        sent: false,
        warning: null,
      }
    : await sendManualPaymentNotification({
        payment,
        decision: "approved",
        reviewNote,
      });

  return noStoreJson({
    success: true,
    decision: "approved",
    requestId,
    activation:
      Array.isArray(activation) && activation.length > 0
        ? activation[0]
        : activation,
    notificationSent: notification.sent,
    notificationWarning: notification.warning,
    wasAlreadyApproved,
  });
}
