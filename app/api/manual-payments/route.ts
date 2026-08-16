import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { getManualPaymentConfig } from "@/lib/billing/manual-payment-config";
import {
  calculatePlanTotalCents,
  getBillingCycleDefinition,
  getPlanDefinition,
} from "@/lib/subscription/plan-catalog";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
      .select("id,status")
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

  return { ok: true as const, config };
}

function getTrustedPlan(planCode: string, billingCycle: string) {
  const plan = getPlanDefinition(planCode);
  const cycle = getBillingCycleDefinition(billingCycle);
  const totalCents = calculatePlanTotalCents(
    planCode,
    billingCycle,
  );

  if (!plan || !cycle || totalCents === null) {
    return null;
  }

  return {
    plan,
    cycle,
    amount: (totalCents / 100).toFixed(2),
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
    const trustedPlan = getTrustedPlan(planCode, billingCycle);
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
    const trustedPlan = getTrustedPlan(planCode, billingCycle);
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
