import { NextResponse } from "next/server";

import {
  getTenhAdminMutationUser,
  getTenhAdminUser,
} from "@/lib/admin/tenh-admin-auth";
import { logTenhAdminAction } from "@/lib/admin/log-tenh-admin-action";
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

async function loadRequests() {
  const { data: rows, error } = await supabaseAdmin
    .from("manual_payment_requests")
    .select(`
      id,
      business_id,
      requested_by_member_id,
      plan_code,
      billing_cycle,
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

  if (businessIds.length > 0) {
    const { data: businesses, error: businessError } =
      await supabaseAdmin
        .from("businesses")
        .select("id,name")
        .in("id", businessIds);

    if (businessError) {
      throw new Error(businessError.message);
    }

    for (const business of businesses ?? []) {
      businessMap.set(
        business.id,
        business.name ?? "TENH workspace",
      );
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
        amount,
        currency
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
