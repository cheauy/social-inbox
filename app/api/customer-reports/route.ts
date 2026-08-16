import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUCKET = "tenh-customer-report-files";
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_ACTIVE_REPORTS = 5;
const SIGNED_URL_SECONDS = 10 * 60;

const CATEGORIES = new Set([
  "billing",
  "technical",
  "account",
  "facebook",
  "other",
]);

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

type CustomerReportBody = {
  action?: unknown;
  category?: unknown;
  subject?: unknown;
  message?: unknown;
  reportId?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  storagePath?: unknown;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function sanitizeFileName(value: string) {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .slice(0, 120);

  return cleaned || "report-attachment";
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

function safeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function validateMutationRequest(request: Request) {
  const requestOrigin = safeOrigin(request.url);
  const suppliedOrigin = safeOrigin(request.headers.get("origin") ?? "");
  const fetchSite = request.headers.get("sec-fetch-site");
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (
    !requestOrigin ||
    !suppliedOrigin ||
    requestOrigin !== suppliedOrigin ||
    (fetchSite && fetchSite !== "same-origin") ||
    !contentType.startsWith("application/json")
  ) {
    return false;
  }

  return true;
}

async function createAttachmentUrl(
  bucket: string | null,
  path: string | null,
) {
  if (!bucket || !path) {
    return null;
  }

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

async function activeReportCount(
  businessId: string,
  memberId: string,
) {
  const { count, error } = await supabaseAdmin
    .from("tenh_customer_reports")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("business_id", businessId)
    .eq("reporter_member_id", memberId)
    .in("status", ["open", "reviewing"]);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function GET() {
  const auth = await getCurrentMember();

  if (!auth.success) {
    return noStoreJson(
      {
        success: false,
        error: auth.error,
      },
      { status: auth.status },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("tenh_customer_reports")
    .select(`
      id,
      category,
      subject,
      message,
      status,
      admin_reply,
      reviewed_at,
      attachment_bucket,
      attachment_path,
      attachment_file_name,
      attachment_mime_type,
      attachment_size_bytes,
      created_at
    `)
    .eq("business_id", auth.member.business_id)
    .eq("reporter_member_id", auth.member.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return noStoreJson(
      {
        success: false,
        error: "Unable to load your reports.",
        details: error.message,
        hint:
          "Run supabase/11-v3-8-8-6-customer-report-attachments.sql after the V3.8.8 customer report migration.",
      },
      { status: 500 },
    );
  }

  const reports = await Promise.all(
    (data ?? []).map(async (row) => ({
      id: row.id,
      category: row.category,
      subject: row.subject,
      message: row.message,
      status: row.status,
      adminReply: row.admin_reply,
      reviewedAt: row.reviewed_at,
      attachmentFileName: row.attachment_file_name,
      attachmentMimeType: row.attachment_mime_type,
      attachmentSizeBytes:
        row.attachment_size_bytes === null
          ? null
          : Number(row.attachment_size_bytes),
      attachmentUrl: await createAttachmentUrl(
        row.attachment_bucket,
        row.attachment_path,
      ),
      createdAt: row.created_at,
    })),
  );

  return noStoreJson({
    success: true,
    reports,
  });
}

export async function POST(request: NextRequest) {
  const auth = await getCurrentMember();

  if (!auth.success) {
    return noStoreJson(
      {
        success: false,
        error: auth.error,
      },
      { status: auth.status },
    );
  }

  if (!validateMutationRequest(request)) {
    return noStoreJson(
      {
        success: false,
        error: "Forbidden report request origin.",
      },
      { status: 403 },
    );
  }

  let body: CustomerReportBody;

  try {
    body = (await request.json()) as CustomerReportBody;
  } catch {
    return noStoreJson(
      {
        success: false,
        error: "Invalid JSON request.",
      },
      { status: 400 },
    );
  }

  const action = clean(body.action).toLowerCase();

  if (action === "prepare-upload") {
    const fileName = clean(body.fileName);
    const mimeType = clean(body.mimeType).toLowerCase();
    const sizeBytes = Number(body.sizeBytes);

    if (
      !fileName ||
      !ALLOWED_MIME_TYPES.has(mimeType) ||
      !Number.isFinite(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > MAX_FILE_SIZE
    ) {
      return noStoreJson(
        {
          success: false,
          error:
            "Attachment must be JPG, PNG, WEBP, or PDF and no larger than 8 MB.",
        },
        { status: 400 },
      );
    }

    try {
      const unresolved = await activeReportCount(
        auth.member.business_id,
        auth.member.id,
      );

      if (unresolved >= MAX_ACTIVE_REPORTS) {
        return noStoreJson(
          {
            success: false,
            error:
              "You already have 5 reports that are still open or under review. Wait for TENH to resolve one before submitting another.",
          },
          { status: 429 },
        );
      }
    } catch (error) {
      return noStoreJson(
        {
          success: false,
          error: "Unable to verify your current support queue.",
          details:
            error instanceof Error ? error.message : undefined,
        },
        { status: 500 },
      );
    }

    const reportId = randomUUID();
    const safeName = sanitizeFileName(fileName);
    const storagePath =
      `${auth.member.business_id}/${auth.member.id}/${reportId}/` +
      `${randomUUID()}-${safeName}`;

    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(storagePath, {
        upsert: false,
      });

    if (error || !data) {
      return noStoreJson(
        {
          success: false,
          error: "Unable to prepare the report attachment upload.",
          details: error?.message,
          hint:
            "Run supabase/11-v3-8-8-6-customer-report-attachments.sql first.",
        },
        { status: 500 },
      );
    }

    return noStoreJson({
      success: true,
      reportId,
      upload: {
        bucket: BUCKET,
        path: storagePath,
        token: data.token,
      },
    });
  }

  if (action !== "submit") {
    return noStoreJson(
      {
        success: false,
        error: "Unsupported customer report action.",
      },
      { status: 400 },
    );
  }

  const category = clean(body.category).toLowerCase();
  const subject = clean(body.subject).slice(0, 140);
  const message = clean(body.message).slice(0, 5000);
  const suppliedReportId = clean(body.reportId).toLowerCase();
  const fileName = clean(body.fileName);
  const mimeType = clean(body.mimeType).toLowerCase();
  const sizeBytes = Number(body.sizeBytes);
  const storagePath = clean(body.storagePath);
  const hasAttachment = Boolean(storagePath);

  if (!CATEGORIES.has(category)) {
    return noStoreJson(
      {
        success: false,
        error: "Choose a valid report category.",
      },
      { status: 400 },
    );
  }

  if (subject.length < 3) {
    return noStoreJson(
      {
        success: false,
        error: "Report subject must be at least 3 characters.",
      },
      { status: 400 },
    );
  }

  if (message.length < 10) {
    return noStoreJson(
      {
        success: false,
        error: "Please describe the issue in at least 10 characters.",
      },
      { status: 400 },
    );
  }

  try {
    const unresolved = await activeReportCount(
      auth.member.business_id,
      auth.member.id,
    );

    if (unresolved >= MAX_ACTIVE_REPORTS) {
      return noStoreJson(
        {
          success: false,
          error:
            "You already have 5 reports that are still open or under review. Wait for TENH to resolve one before submitting another.",
        },
        { status: 429 },
      );
    }
  } catch (error) {
    return noStoreJson(
      {
        success: false,
        error: "Unable to verify your current support queue.",
        details:
          error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }

  const reportId = suppliedReportId || randomUUID();

  if (!isUuid(reportId)) {
    return noStoreJson(
      {
        success: false,
        error: "Invalid customer report ID.",
      },
      { status: 400 },
    );
  }

  if (hasAttachment) {
    const expectedPrefix =
      `${auth.member.business_id}/${auth.member.id}/${reportId}/`;

    if (
      !storagePath.startsWith(expectedPrefix) ||
      !fileName ||
      !ALLOWED_MIME_TYPES.has(mimeType) ||
      !Number.isFinite(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > MAX_FILE_SIZE
    ) {
      return noStoreJson(
        {
          success: false,
          error: "Invalid report attachment metadata.",
        },
        { status: 400 },
      );
    }

    const folder = `${auth.member.business_id}/${auth.member.id}/${reportId}`;
    const uploadedObjectName = storagePath.split("/").pop() ?? "";
    const { data: objects, error: listError } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(folder, {
        limit: 50,
      });

    const exists =
      !listError &&
      (objects ?? []).some((item) => item.name === uploadedObjectName);

    if (!exists) {
      return noStoreJson(
        {
          success: false,
          error:
            "TENH could not confirm the uploaded report attachment. Upload it again.",
          details: listError?.message,
        },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("tenh_customer_reports")
    .insert({
      id: reportId,
      business_id: auth.member.business_id,
      reporter_member_id: auth.member.id,
      category,
      subject,
      message,
      status: "open",
      attachment_bucket: hasAttachment ? BUCKET : null,
      attachment_path: hasAttachment ? storagePath : null,
      attachment_file_name: hasAttachment
        ? fileName.slice(0, 255)
        : null,
      attachment_mime_type: hasAttachment ? mimeType : null,
      attachment_size_bytes: hasAttachment
        ? Math.trunc(sizeBytes)
        : null,
    })
    .select("id,status,created_at")
    .single();

  if (error || !data) {
    if (hasAttachment) {
      await supabaseAdmin.storage.from(BUCKET).remove([storagePath]);
    }

    return noStoreJson(
      {
        success: false,
        error: "Unable to submit your report.",
        details: error?.message,
      },
      { status: 500 },
    );
  }

  return noStoreJson({
    success: true,
    report: {
      id: data.id,
      status: data.status,
      createdAt: data.created_at,
    },
  });
}
