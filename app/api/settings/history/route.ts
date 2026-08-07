import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedActivityTypes = new Set([
  "status_changed",
  "assigned",
  "unassigned",
  "tag_added",
  "tag_removed",
  "note_added",
  "note_updated",
  "note_deleted",
  "customer_updated",
]);

export async function GET(
  request: NextRequest,
) {
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

  const currentMember =
    authResult.member;

  const searchParams =
    request.nextUrl.searchParams;

  const search =
    searchParams
      .get("search")
      ?.trim() ?? "";

  const activityType =
    searchParams
      .get("activityType")
      ?.trim() ?? "all";

  const page = Math.max(
    Number(
      searchParams.get("page") ??
        "1",
    ),
    1,
  );

  const pageSize = Math.min(
    Math.max(
      Number(
        searchParams.get("pageSize") ??
          "10",
      ),
      1,
    ),
    100,
  );

  if (
    activityType !== "all" &&
    !allowedActivityTypes.has(
      activityType,
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Invalid activity type.",
      },
      {
        status: 400,
      },
    );
  }

  const from =
    (page - 1) * pageSize;

  const to =
    from + pageSize - 1;

  let query =
    supabaseAdmin
      .from("conversation_activity")
      .select(
        `
          id,
          business_id,
          conversation_id,
          contact_id,
          actor_member_id,
          activity_type,
          title,
          description,
          customer_name,
          actor_name,
          actor_profile_picture_url,
          metadata,
          created_at
        `,
        {
          count: "exact",
        },
      )
      .eq(
        "business_id",
        currentMember.business_id,
      );

  if (
    activityType !== "all"
  ) {
    query = query.eq(
      "activity_type",
      activityType,
    );
  }

  if (search) {
    const safeSearch =
      search.replaceAll(",", " ");

    query = query.or(
      [
        `actor_name.ilike.%${safeSearch}%`,
        `customer_name.ilike.%${safeSearch}%`,
        `title.ilike.%${safeSearch}%`,
        `description.ilike.%${safeSearch}%`,
      ].join(","),
    );
  }

  const {
    data,
    error,
    count,
  } = await query
    .order("created_at", {
      ascending: false,
    })
    .range(from, to);

  if (error) {
    console.error(
      "Unable to load settings history:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load settings history.",
        details: error.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    activities: data ?? [],
    pagination: {
      page,
      pageSize,
      total: count ?? 0,
      totalPages: Math.max(
        Math.ceil(
          (count ?? 0) /
            pageSize,
        ),
        1,
      ),
    },
  });
}