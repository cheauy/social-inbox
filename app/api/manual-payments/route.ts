import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import { getManualPaymentConfig } from "@/lib/billing/manual-payment-config";
import { getManualPaymentPayWaySafety } from "@/lib/billing/manual-payment-payway-safety";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { getTrustedPlan, buildPurchaseRecord, type SubscriptionForQuote } from "@/lib/billing/subscription-purchase";
import { syncBusinessSubscriptionLifecycle } from "@/lib/subscription/sync-subscription-lifecycle";
import { getPendingBakongPayment } from "@/lib/billing/pending-bakong-payment";
import { payWayCheckoutExpiresAt, payWayCheckoutSessionClosedAt } from "@/lib/payway/checkout-lifetime";

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
  extensionBillingCycle?: unknown;
  purchaseBusinessId?: unknown;
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

async function requireOwner(requestedBusinessId: string | null = null) {
  const authResult = await getCurrentMember(true);

  if (!authResult.success) {
    return {
      response: NextResponse.json(
        {
          success: false,
          error: authResult.error,
          code: authResult.code,
          businessId: authResult.businessId,
        },
        { status: authResult.status },
      ),
      member: null,
    };
  }

  let billingMember = authResult.member;

  if (
    requestedBusinessId &&
    requestedBusinessId !== authResult.member.business_id
  ) {
    const { data: targetMember, error: targetMemberError } =
      await supabaseAdmin
        .from("team_members")
        .select(
          "id,user_id,business_id,full_name,email,role,profile_picture_url,is_active",
        )
        .eq("business_id", requestedBusinessId)
        .eq("user_id", authResult.user.id)
        .eq("is_active", true)
        .maybeSingle();

    if (targetMemberError || !targetMember) {
      return {
        response: NextResponse.json(
          {
            success: false,
            error: "You do not have access to this subscription.",
          },
          { status: 403 },
        ),
        member: null,
      };
    }

    billingMember = targetMember as typeof authResult.member;
  }

  if (
    !(await memberHasPermission(
      billingMember,
      "billing",
      "manage",
    ))
  ) {
    return {
      response: NextResponse.json(
        {
          success: false,
          error:
            "You do not have Subscription & billing Manage permission for this workspace.",
        },
        { status: 403 },
      ),
      member: null,
    };
  }

  return {
    response: null,
    member: billingMember,
  };
}

async function verifyManualPaymentAvailable(
  businessId: string,
) {
  try {
    await syncBusinessSubscriptionLifecycle(businessId);
  } catch (error) {
    console.error("[TENH Manual Payment] Subscription lifecycle sync failed:", error);
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          success: false,
          error: "Unable to verify the subscription status before payment.",
        },
        { status: 503 },
      ),
    };
  }

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
      .select("*")
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

function activePayWayPurchaseAlreadyApplied(
  subscription: SubscriptionForQuote,
  trustedPlan: ReturnType<typeof getTrustedPlan>,
) {
  if (!trustedPlan) return false;

  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end).getTime()
    : null;
  const paidPeriodActive =
    subscription.status === "active" &&
    (periodEnd === null ||
      (Number.isFinite(periodEnd) && periodEnd > Date.now()));

  return (
    paidPeriodActive &&
    subscription.payment_provider === "payway" &&
    subscription.plan_code === trustedPlan.plan.id &&
    subscription.billing_cycle === trustedPlan.cycle.id
  );
}

async function guardAgainstDuplicatePayWayPurchase(
  businessId: string,
  subscription: SubscriptionForQuote,
  trustedPlan: NonNullable<ReturnType<typeof getTrustedPlan>>,
  manualCreatedAt?: string | null,
) {
  const bakongAttemptId = await getPendingBakongPayment(businessId);
  if (bakongAttemptId) return NextResponse.json({ success: false, code: "TENH_BILLING_PURCHASE_PENDING", businessId,
    bakongAttemptId, error: "An existing payment needs to be reconciled first." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  if (activePayWayPurchaseAlreadyApplied(subscription, trustedPlan)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "This purchase is already active from a verified ABA PayWay payment. Do not upload the ABA receipt again as a manual bank-transfer payment.",
        code: "TENH_MANUAL_DUPLICATE_PAYWAY_ACTIVE",
      },
      { status: 409 },
    );
  }

  const safety = await getManualPaymentPayWaySafety({
    businessId,
    planCode: trustedPlan.plan.id,
    billingCycle: trustedPlan.cycle.id,
    amount: Number(trustedPlan.amount),
    targetMemberLimit: trustedPlan.quote.users,
    targetChannelLimit: trustedPlan.quote.channels,
    manualCreatedAt,
  });

  if (safety.blocked) {
    return NextResponse.json(
      {
        success: false,
        error: safety.message,
        code:
          safety.kind === "approved"
            ? "TENH_MANUAL_DUPLICATE_PAYWAY_APPROVED"
            : "TENH_MANUAL_PAYWAY_STILL_PENDING",
      },
      { status: 409 },
    );
  }

  return null;
}

const MANUAL_REQUEST_SELECT = "id,business_id,requested_by_member_id,plan_code,billing_cycle,amount,currency,status,proof_file_name,review_note,reviewed_at,approved_at,created_at,proof_bucket,proof_path,proof_mime_type,proof_size_bytes";
const MANUAL_UPLOAD_SELECT = "id,business_id,member_id,storage_path,file_name,mime_type,size_bytes,selection,request_payload,state,created_at";
const REQUEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ManualRequestRow = Parameters<typeof requestDto>[0] & {
  business_id: string; requested_by_member_id: string | null; proof_path: string;
  proof_bucket: string; proof_mime_type: string; proof_size_bytes: number;
};
type ManualUpload = {
  id: string; business_id: string; member_id: string; storage_path: string; file_name: string;
  mime_type: string; size_bytes: number; selection: Record<string, unknown>;
  request_payload: Record<string, unknown>; state: string; created_at: string;
};
function manualJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
function manualError(error: string, status: number, code?: string) {
  return manualJson({ success: false, error, ...(code ? { code } : {}) }, status);
}
function manualSelection(body: ManualPaymentBody) {
  const number = (value: unknown) => value == null || value === "" ? null : Number(value);
  const bool = (value: unknown) => value === true || clean(value).toLowerCase() === "true";
  return { planCode: clean(body.planCode), billingCycle: clean(body.billingCycle),
    connections: number(body.connections), users: number(body.users), renewSame: bool(body.renewSame),
    customUpgrade: bool(body.customUpgrade), extensionBillingCycle: clean(body.extensionBillingCycle) || null };
}
function ticketMatches(ticket: ManualUpload, body: ManualPaymentBody, requireMetadata = false, requireSelection = false) {
  if ((requireMetadata || body.fileName !== undefined) && clean(body.fileName).slice(0, 255) !== ticket.file_name) return false;
  if ((requireMetadata || body.mimeType !== undefined) && clean(body.mimeType).toLowerCase() !== ticket.mime_type) return false;
  if ((requireMetadata || body.sizeBytes !== undefined) && Number(body.sizeBytes) !== Number(ticket.size_bytes)) return false;
  if (body.storagePath !== undefined && clean(body.storagePath) !== ticket.storage_path) return false;
  const selection = manualSelection(body);
  return Object.keys(selection).every(key => (!requireSelection && body[key as keyof ManualPaymentBody] === undefined)
    || selection[key as keyof typeof selection] === ticket.selection[key]);
}
function preparedDto(ticket: ManualUpload, memberId: string) {
  const canResume = ticket.member_id === memberId;
  return { id: ticket.id, businessId: ticket.business_id, state: ticket.state, canResume, createdAt: ticket.created_at,
    ...(canResume ? { fileName: ticket.file_name, mimeType: ticket.mime_type, sizeBytes: Number(ticket.size_bytes) } : {}) };
}
function storedProofMissing(error: unknown) {
  const value = error as { status?: string | number; statusCode?: string | number; message?: string } | null;
  return Number(value?.statusCode ?? value?.status) === 404 || /not found|does not exist/i.test(value?.message ?? "");
}
function loadManualRequest(id: string, businessId: string) {
  return supabaseAdmin.from("manual_payment_requests").select(MANUAL_REQUEST_SELECT).eq("id", id).eq("business_id", businessId).maybeSingle();
}
function loadManualUpload(id: string, businessId: string, memberId: string) {
  return supabaseAdmin.from("manual_payment_uploads").select(MANUAL_UPLOAD_SELECT).eq("id", id)
    .eq("business_id", businessId).eq("member_id", memberId).maybeSingle();
}

function preparedRequestPayload(requestId: string, businessId: string, memberId: string,
  trustedPlan: NonNullable<ReturnType<typeof getTrustedPlan>>, subscription: SubscriptionForQuote,
  fileName: string, mimeType: string, sizeBytes: number, storagePath: string) {
  return { ...buildPurchaseRecord(requestId, businessId, memberId, trustedPlan, subscription),
    status: "submitted", transfer_reference: null, customer_note: null, proof_bucket: BUCKET,
    proof_path: storagePath, proof_file_name: fileName.slice(0, 255), proof_mime_type: mimeType,
    proof_size_bytes: Math.trunc(sizeBytes) };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const owner = await requireOwner(url.searchParams.get("purchase_business")?.trim() || null);
  if (owner.response || !owner.member) return owner.response;
  const businessId = owner.member.business_id, memberId = owner.member.id;
  const requestId = url.searchParams.get("request_id")?.trim() || null;
  if (requestId && !REQUEST_UUID.test(requestId)) return manualError("Invalid payment request identifier.", 400);
  let query = supabaseAdmin.from("manual_payment_requests").select(MANUAL_REQUEST_SELECT).eq("business_id", businessId);
  if (requestId) query = query.eq("id", requestId);
  else if (url.searchParams.get("mode") === "checkout") query = query.eq("status", "submitted");
  const saved = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (saved.error) return manualError("Unable to load manual payment information.", 503);
  let ticket: ManualUpload | null = null;
  if (!saved.data && (requestId || url.searchParams.get("mode") === "checkout")) {
    const prepared = requestId ? await loadManualUpload(requestId, businessId, memberId)
      : await supabaseAdmin.from("manual_payment_uploads").select(MANUAL_UPLOAD_SELECT)
        .eq("business_id", businessId).eq("state", "prepared").limit(1).maybeSingle();
    if (prepared.error) return manualError("Payment upload reconciliation is unavailable. Retry shortly.", 503, "TENH_MANUAL_UPLOAD_MIGRATION_REQUIRED");
    ticket = prepared.data as ManualUpload | null;
    if (requestId && !ticket) return manualError("Manual payment attempt was not found.", 404);
  }
  // Checkout discovery covers the other retained payment method too. This is
  // a saved-state read under the same authorized target workspace, with no
  // provider inquiry, preparation, cancellation, or settlement inference.
  const payWay = !requestId && url.searchParams.get("mode") === "checkout"
    ? await supabaseAdmin.from("billing_transactions").select("provider_transaction_id,metadata")
      .eq("business_id", businessId).eq("provider", "payway").in("status", ["pending", "processing", "draft", "created"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null, error: null };
  if (payWay.error) return manualError("Unable to check existing payments. Try again.", 503);
  const checkoutExpiresAt = payWayCheckoutExpiresAt(payWay.data?.metadata);
  // Ending the UI session does not resolve money. Keep the purchase guard,
  // but do not resume an ended checkout as an active payment again.
  const payWayReviewRequired = Boolean(payWay.data && (payWayCheckoutSessionClosedAt(payWay.data.metadata) ||
    (checkoutExpiresAt && Date.parse(checkoutExpiresAt) <= Date.now())));
  return manualJson({ success: true, businessId, memberId, config: getManualPaymentConfig(),
    request: saved.data ? requestDto(saved.data as ManualRequestRow) : null,
    payWayAttemptId: payWay.data?.provider_transaction_id ?? null,
    payWayReviewRequired,
    preparedAttempt: ticket ? preparedDto(ticket, memberId) : null });
}

export async function POST(request: Request) {
  let body: ManualPaymentBody;
  try { body = await request.json() as ManualPaymentBody; }
  catch { return manualError("Manual payment request must be valid JSON.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return manualError("Invalid manual payment action.", 400);
  const owner = await requireOwner(clean(body.purchaseBusinessId) || null);
  if (owner.response || !owner.member) return owner.response;
  const businessId = owner.member.business_id, memberId = owner.member.id;
  const identity = { businessId, memberId };
  const action = clean(body.action);
  if (!["prepare-upload", "resume-upload", "finalize-upload", "abort-upload"].includes(action)) return manualError("Unsupported manual payment action.", 400);
  const requestId = clean(body.requestId) || (action === "prepare-upload" ? randomUUID() : "");
  if (!REQUEST_UUID.test(requestId)) return manualError("Invalid payment request identifier.", 400);
  const requestResult = (saved: ManualRequestRow) => manualJson({ success: true, ...identity, requestId, request: requestDto(saved) });
  const existing = await loadManualRequest(requestId, businessId);
  if (existing.error) return manualError("Unable to reconcile this payment request.", 503, "TENH_MANUAL_SUBMISSION_UNCERTAIN");
  if (existing.data) {
    const saved = existing.data as ManualRequestRow;
    if (saved.requested_by_member_id !== memberId) return manualError("This upload belongs to another initiating member.", 403);
    if (action === "abort-upload") return manualError("A submitted payment cannot be aborted.", 409, "TENH_MANUAL_ALREADY_SUBMITTED");
    if ((body.storagePath !== undefined && clean(body.storagePath) !== saved.proof_path)
      || (body.fileName !== undefined && clean(body.fileName).slice(0, 255) !== saved.proof_file_name)
      || (body.mimeType !== undefined && clean(body.mimeType).toLowerCase() !== saved.proof_mime_type)
      || (body.sizeBytes !== undefined && Number(body.sizeBytes) !== Number(saved.proof_size_bytes))
      || (body.planCode !== undefined && clean(body.planCode) !== saved.plan_code)
      || (body.billingCycle !== undefined && clean(body.billingCycle) !== saved.billing_cycle)) return manualError("Payment metadata does not match the recorded request.", 400);
    return requestResult(saved);
  }
  const loaded = await loadManualUpload(requestId, businessId, memberId);
  if (loaded.error) return manualError("Prepared payment uploads are unavailable. Retry after the billing migration is installed.", 503, "TENH_MANUAL_UPLOAD_MIGRATION_REQUIRED");
  let ticket = loaded.data as ManualUpload | null;
  if (!ticket && action !== "prepare-upload") return manualError("The prepared payment upload was not found for this membership.", 404);
  if (ticket && !ticketMatches(ticket, body, action === "prepare-upload" || action === "resume-upload", action === "prepare-upload")) {
    return manualError("Use the original file and purchase selection for this prepared payment.", 400);
  }
  if (ticket && ticket.state === "aborted" && action === "abort-upload") return manualJson({ success: true, ...identity, requestId,
    preparedAttempt: { id: requestId, businessId, state: "aborted", canResume: false } });
  if (ticket && ticket.state === "submitted") {
    const committed = await loadManualRequest(requestId, businessId);
    if (committed.data && (committed.data as ManualRequestRow).requested_by_member_id === memberId
      && (committed.data as ManualRequestRow).proof_path === ticket.storage_path) return requestResult(committed.data as ManualRequestRow);
    return manualError("The submitted payment needs reconciliation. Do not submit or pay again.", 503, "TENH_MANUAL_SUBMISSION_UNCERTAIN");
  }
  if (ticket && ticket.state !== "prepared") return manualError("This payment attempt is no longer open.", 409, "TENH_MANUAL_ATTEMPT_CLOSED");
  let isNew = false;
  if (!ticket) {
    const guards = await supabaseAdmin.rpc("tenh_payment_application_guards_ready");
    if (guards.error || guards.data !== true) return manualError("Payment application safety is unavailable. Retry after the billing migration is installed.", 503, "TENH_BILLING_APPLICATION_MIGRATION_REQUIRED");
    const availability = await verifyManualPaymentAvailable(businessId);
    if (!availability.ok) return availability.response;
    const selection = manualSelection(body);
    if (selection.renewSame && owner.member.role !== "owner") return permissionDenied("Only the workspace Owner can reactivate the preserved subscription.");
    const trustedPlan = getTrustedPlan(selection.planCode, selection.billingCycle, body.connections, body.users,
      selection.renewSame, selection.customUpgrade, body.extensionBillingCycle, availability.subscription as SubscriptionForQuote);
    if (!trustedPlan) return manualError("Invalid TENH plan or billing period.", 400);
    if (owner.member.role !== "owner" && trustedPlan.purchaseType !== "upgrade" && trustedPlan.purchaseType !== "custom-upgrade") {
      return permissionDenied("Subscription & billing Manage allows upgrades only. Buy new subscription creates your own workspace.");
    }
    const conflict = await guardAgainstDuplicatePayWayPurchase(businessId, availability.subscription as SubscriptionForQuote, trustedPlan);
    if (conflict) return conflict;
    const fileName = clean(body.fileName).slice(0, 255), mimeType = clean(body.mimeType).toLowerCase(), sizeBytes = Number(body.sizeBytes);
    if (!fileName || !ALLOWED_MIME_TYPES.has(mimeType) || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FILE_SIZE) {
      return manualError("Payment proof must be JPG, PNG, WEBP, or PDF and no larger than 10 MB.", 400);
    }
    const storagePath = businessId + "/" + requestId + "/" + randomUUID() + "-" + sanitizeFileName(fileName);
    const payload = preparedRequestPayload(requestId, businessId, memberId, trustedPlan,
      availability.subscription as SubscriptionForQuote, fileName, mimeType, sizeBytes, storagePath);
    const created = await supabaseAdmin.from("manual_payment_uploads").insert({ id: requestId, business_id: businessId,
      member_id: memberId, storage_path: storagePath, file_name: fileName, mime_type: mimeType, size_bytes: sizeBytes,
      selection, request_payload: payload, state: "prepared" }).select(MANUAL_UPLOAD_SELECT).single();
    if (created.error || !created.data) {
      const reconciled = await loadManualUpload(requestId, businessId, memberId);
      if (reconciled.error) return manualError("Preparation may have completed. Reconcile this same attempt before trying another purchase.", 503, "TENH_MANUAL_PREPARATION_UNCERTAIN");
      ticket = reconciled.data as ManualUpload | null;
      if (!ticket) return created.error?.code === "23505"
        ? manualError("An unresolved payment attempt must be reconciled before another purchase.", 409, "TENH_BILLING_PURCHASE_PENDING")
        : manualError("Preparation could not be confirmed. Reconcile this same attempt before another purchase.", 503, "TENH_MANUAL_PREPARATION_UNCERTAIN");
      if (!ticketMatches(ticket, body, true, true)) return manualError("Use the original file and purchase selection for this prepared payment.", 400);
      if (ticket.state === "submitted") {
        const committed = await loadManualRequest(requestId, businessId);
        if (committed.data && (committed.data as ManualRequestRow).requested_by_member_id === memberId
          && (committed.data as ManualRequestRow).proof_path === ticket.storage_path) return requestResult(committed.data as ManualRequestRow);
        return manualError("The submitted payment needs reconciliation. Do not submit or pay again.", 503, "TENH_MANUAL_SUBMISSION_UNCERTAIN");
      }
      if (ticket.state !== "prepared") return manualError("This payment attempt has already changed. Reconcile its saved status.", 409);
    } else { ticket = created.data as ManualUpload; isNew = true; }
  }
  if (action === "abort-upload") {
    const aborted = await supabaseAdmin.rpc("tenh_abort_manual_payment_upload", {
      p_request_id: requestId, p_business_id: businessId, p_member_id: memberId,
    });
    if (aborted.error || aborted.data?.id !== requestId || aborted.data?.business_id !== businessId || aborted.data?.state !== "aborted") {
      return manualError("Unable to confirm cancellation. Reconcile this same attempt before another purchase.", 409, "TENH_MANUAL_ABORT_UNCERTAIN");
    }
    return manualJson({ success: true, ...identity, requestId, preparedAttempt: { id: requestId, businessId, state: "aborted", canResume: false } });
  }
  const proof = isNew ? null : await supabaseAdmin.storage.from(BUCKET).info(ticket.storage_path);
  if (proof?.error && !storedProofMissing(proof.error)) return manualError("Unable to verify the saved proof. Reconcile this attempt before uploading again.", 503, "TENH_MANUAL_SUBMISSION_UNCERTAIN");
  const proofUploaded = Boolean(proof?.data);
  if (proofUploaded && (Number(proof?.data?.size) !== Number(ticket.size_bytes)
    || proof?.data?.contentType?.split(";")[0].trim().toLowerCase() !== ticket.mime_type)) return manualError("The uploaded proof does not match this prepared payment.", 400);
  if (action === "prepare-upload" || action === "resume-upload") {
    const signed = proofUploaded ? null : await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(ticket.storage_path, { upsert: false });
    if (!proofUploaded && (signed?.error || !signed?.data)) return manualError("The attempt is saved, but the upload link could not be prepared. Resume this same attempt.", 503, "TENH_MANUAL_PREPARATION_UNCERTAIN");
    return manualJson({ success: true, ...identity, requestId, preparedAttempt: preparedDto(ticket, memberId), proofUploaded,
      trustedAmount: ticket.request_payload.amount, currency: "USD",
      upload: { bucket: BUCKET, path: ticket.storage_path, token: signed?.data?.token ?? null } });
  }
  if (!proofUploaded) return manualError("The proof has not finished uploading. Resume this same payment attempt.", 409, "UPLOAD_INCOMPLETE");
  const finalized = await supabaseAdmin.rpc("tenh_finalize_manual_payment_upload", {
    p_request_id: requestId, p_business_id: businessId, p_member_id: memberId, p_customer_note: clean(body.customerNote).slice(0, 1000) || null,
  });
  if (finalized.error || !finalized.data) {
    const reconciled = await loadManualRequest(requestId, businessId);
    if (reconciled.data && (reconciled.data as ManualRequestRow).requested_by_member_id === memberId
      && (reconciled.data as ManualRequestRow).proof_path === ticket.storage_path) return requestResult(reconciled.data as ManualRequestRow);
    if (finalized.error?.code === "42501") return manualError("Payment upload permission was revoked.", 403);
    if (finalized.error?.code === "22023") {
      const current = await loadManualUpload(requestId, businessId, memberId);
      if (current.data?.state === "aborted") return manualError("This payment attempt is no longer open.", 409, "TENH_MANUAL_ATTEMPT_CLOSED");
    }
    return manualError("The proof is preserved. Reconcile this same attempt before submitting or paying again.", 503, "TENH_MANUAL_SUBMISSION_UNCERTAIN");
  }
  const saved = finalized.data as ManualRequestRow;
  if (saved.id !== requestId || saved.business_id !== businessId || saved.requested_by_member_id !== memberId || saved.proof_path !== ticket.storage_path) {
    return manualError("Manual payment confirmation returned a different attempt. Reconcile before paying again.", 503, "TENH_MANUAL_SUBMISSION_UNCERTAIN");
  }
  return requestResult(saved);
}
