import { NextResponse } from "next/server";

import { getTenhAdminUser } from "@/lib/admin/tenh-admin-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

async function countByStatus(
  table: string,
  status: string,
) {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("status", status);

  if (error) {
    throw new Error(`${table}: ${error.message}`);
  }

  return count ?? 0;
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
    const [
      manualSubmitted,
      manualApproved,
      manualRejected,
      reportsOpen,
      reportsReviewing,
      reportsResolved,
      announcementsResult,
    ] = await Promise.all([
      countByStatus("manual_payment_requests", "submitted"),
      countByStatus("manual_payment_requests", "approved"),
      countByStatus("manual_payment_requests", "rejected"),
      countByStatus("tenh_customer_reports", "open"),
      countByStatus("tenh_customer_reports", "reviewing"),
      countByStatus("tenh_customer_reports", "resolved"),
      supabaseAdmin
        .from("tenh_system_announcements")
        .select("is_active,starts_at,ends_at")
        .eq("is_active", true)
        .limit(100),
    ]);

    if (announcementsResult.error) {
      throw new Error(
        `tenh_system_announcements: ${announcementsResult.error.message}`,
      );
    }

    const now = Date.now();
    const activeAnnouncements = (announcementsResult.data ?? []).filter(
      (row) => {
        const startsAt = new Date(row.starts_at).getTime();
        const endsAt = row.ends_at
          ? new Date(row.ends_at).getTime()
          : null;

        return (
          (!Number.isFinite(startsAt) || startsAt <= now) &&
          (!endsAt || !Number.isFinite(endsAt) || endsAt > now)
        );
      },
    ).length;

    const reportActionable = reportsOpen + reportsReviewing;
    const actionable = manualSubmitted + reportActionable;

    return noStoreJson({
      success: true,
      summary: {
        manualSubmitted,
        manualApproved,
        manualRejected,
        reportsOpen,
        reportsReviewing,
        reportsResolved,
        reportActionable,
        activeAnnouncements,
        actionable,
      },
    });
  } catch (error) {
    return noStoreJson(
      {
        success: false,
        error: "Unable to load TENH admin queue summary.",
        details:
          error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}
