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

const SIGNED_URL_SECONDS = 10 * 60;

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

async function loadReports() {
  const { data: rows, error } = await supabaseAdmin
    .from("tenh_customer_reports")
    .select(`
      id,
      business_id,
      reporter_member_id,
      category,
      subject,
      message,
      status,
      admin_reply,
      reviewed_by_email,
      reviewed_at,
      attachment_bucket,
      attachment_path,
      attachment_file_name,
      attachment_mime_type,
      attachment_size_bytes,
      created_at
    `)
    .order("created_at", { ascending: false })
    .limit(250);

  if (error) {
    throw new Error(error.message);
  }

  const businessIds = Array.from(
    new Set((rows ?? []).map((row) => row.business_id)),
  );
  const memberIds = Array.from(
    new Set(
      (rows ?? [])
        .map((row) => row.reporter_member_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const businessMap = new Map<string, string>();
  const memberMap = new Map<
    string,
    {
      full_name: string | null;
      email: string | null;
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

  if (memberIds.length > 0) {
    const { data: members, error: memberError } = await supabaseAdmin
      .from("team_members")
      .select("id,full_name,email")
      .in("id", memberIds);

    if (memberError) {
      throw new Error(memberError.message);
    }

    for (const member of members ?? []) {
      memberMap.set(member.id, {
        full_name: member.full_name,
        email: member.email,
      });
    }
  }

  return Promise.all(
    (rows ?? []).map(async (row) => {
      const reporter = row.reporter_member_id
        ? memberMap.get(row.reporter_member_id) ?? null
        : null;

      return {
        id: row.id,
        businessId: row.business_id,
        businessName:
          businessMap.get(row.business_id) ?? "TENH workspace",
        reporterMemberId: row.reporter_member_id,
        reporterName: reporter?.full_name ?? null,
        reporterEmail: reporter?.email ?? null,
        category: row.category,
        subject: row.subject,
        message: row.message,
        status: row.status,
        adminReply: row.admin_reply,
        reviewedByEmail: row.reviewed_by_email,
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
      };
    }),
  );
}

function supportNotificationContent(
  status: string,
  reply: string,
  subject: string,
) {
  if (reply) {
    return {
      title: "TENH replied to your report",
      body: reply.slice(0, 400),
    };
  }

  if (status === "resolved") {
    return {
      title: "TENH resolved your report",
      body: `Your report “${subject}” has been marked resolved.`,
    };
  }

  if (status === "reviewing") {
    return {
      title: "TENH is reviewing your report",
      body: `Your report “${subject}” is now under review.`,
    };
  }

  return {
    title: "TENH reopened your report",
    body: `Your report “${subject}” is open again.`,
  };
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
    const reports = await loadReports();

    return noStoreJson({
      success: true,
      reports,
    });
  } catch (error) {
    return noStoreJson(
      {
        success: false,
        error: "Unable to load customer reports.",
        details:
          error instanceof Error ? error.message : undefined,
        hint:
          "Run supabase/11-v3-8-8-6-customer-report-attachments.sql after the V3.8.8 customer report migration.",
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
    reportId?: unknown;
    status?: unknown;
    adminReply?: unknown;
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

  const reportId = clean(body.reportId);
  const status = clean(body.status).toLowerCase();
  const adminReply = clean(body.adminReply).slice(0, 2000);

  if (
    !reportId ||
    !["open", "reviewing", "resolved"].includes(status)
  ) {
    return noStoreJson(
      {
        success: false,
        error: "reportId and a valid status are required.",
      },
      { status: 400 },
    );
  }

  const { data: current, error: currentError } = await supabaseAdmin
    .from("tenh_customer_reports")
    .select(`
      id,
      business_id,
      reporter_member_id,
      subject,
      status,
      admin_reply
    `)
    .eq("id", reportId)
    .maybeSingle();

  if (currentError) {
    return noStoreJson(
      {
        success: false,
        error: "Unable to load the customer report before updating it.",
        details: currentError.message,
      },
      { status: 500 },
    );
  }

  if (!current) {
    return noStoreJson(
      {
        success: false,
        error: "Customer report was not found.",
      },
      { status: 404 },
    );
  }

  const previousReply = clean(current.admin_reply);
  const statusChanged = current.status !== status;
  const replyChanged = previousReply !== adminReply;

  if (!statusChanged && !replyChanged) {
    return noStoreJson({
      success: true,
      report: {
        id: current.id,
        status: current.status,
      },
      unchanged: true,
    });
  }

  const reviewedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("tenh_customer_reports")
    .update({
      status,
      admin_reply: adminReply || null,
      reviewed_by_user_id: admin.user.id,
      reviewed_by_email: admin.user.email ?? null,
      reviewed_at: reviewedAt,
    })
    .eq("id", reportId)
    .select("id,status,business_id,reporter_member_id,subject")
    .maybeSingle();

  if (error) {
    return noStoreJson(
      {
        success: false,
        error: "Unable to update the customer report.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  if (!data) {
    return noStoreJson(
      {
        success: false,
        error: "Customer report was not found.",
      },
      { status: 404 },
    );
  }

  if (data.reporter_member_id) {
    const notification = supportNotificationContent(
      status,
      replyChanged ? adminReply : "",
      data.subject,
    );

    const { error: notificationError } = await supabaseAdmin
      .from("team_notifications")
      .insert({
        business_id: data.business_id,
        recipient_member_id: data.reporter_member_id,
        actor_member_id: null,
        notification_type: "tenh_customer_report",
        title: notification.title,
        body: notification.body,
        link: "/dashboard/report",
        is_read: false,
      });

    if (notificationError) {
      console.error(
        "[TENH V3.8.8.6] Unable to create customer report notification:",
        notificationError.message,
      );
    }
  }

  await logTenhAdminAction({
    user: admin.user,
    action: "customer_report_updated",
    resourceType: "customer_report",
    resourceId: reportId,
    metadata: {
      businessId: data.business_id,
      status,
      statusChanged,
      replyChanged,
      hasAdminReply: Boolean(adminReply),
    },
  });

  return noStoreJson({
    success: true,
    report: {
      id: data.id,
      status: data.status,
    },
    customerNotificationCreated: Boolean(data.reporter_member_id),
  });
}
