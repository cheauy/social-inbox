import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    customerId: string;
  }>;
};

const PAGE_SIZE = 20;

type TimelineActivity = {
  id: string;
  conversation_id: string | null;
  contact_id: string | null;
  activity_type: string;
  title: string;
  description: string | null;
  actor_name: string | null;
  actor_profile_picture_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export async function GET(
  request: NextRequest,
  context: RouteContext,
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

  const member =
    authResult.member;

  const { customerId } =
    await context.params;

  if (!customerId?.trim()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  const cursor =
    request.nextUrl.searchParams.get(
      "cursor",
    );

  const limitValue =
    Number(
      request.nextUrl.searchParams.get(
        "limit",
      ),
    ) || PAGE_SIZE;

  const pageSize =
    Math.min(
      Math.max(limitValue, 1),
      100,
    );

  const {
    data: contact,
    error: contactError,
  } = await supabaseAdmin
    .from("contacts")
    .select(`
      id,
      business_id,
      full_name
    `)
    .eq("id", customerId)
    .eq(
      "business_id",
      member.business_id,
    )
    .maybeSingle();

  if (contactError) {
    return NextResponse.json(
      {
        success: false,
        error:
          contactError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!contact) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer not found.",
      },
      {
        status: 404,
      },
    );
  }

  let query =
    supabaseAdmin
      .from(
        "conversation_activity",
      )
      .select(
        `
        id,
        conversation_id,
        contact_id,
        activity_type,
        title,
        description,
        actor_name,
        actor_profile_picture_url,
        metadata,
        created_at
      `,
      )
      .eq(
        "business_id",
        member.business_id,
      )
      .eq(
        "contact_id",
        customerId,
      )
      .order(
        "created_at",
        {
          ascending: false,
        },
      )
      .limit(pageSize + 1);

  if (cursor) {
    query =
      query.lt(
        "created_at",
        cursor,
      );
  }

  const {
    data,
    error,
  } = await query;

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error.message,
      },
      {
        status: 500,
      },
    );
  }

  const rows =
    (data ??
      []) as TimelineActivity[];

  const hasMore =
    rows.length > pageSize;

  const activities =
    hasMore
      ? rows.slice(
          0,
          pageSize,
        )
      : rows;

  const nextCursor =
    hasMore
      ? activities[
          activities.length -
            1
        ]?.created_at ??
        null
      : null;

  return NextResponse.json({
    success: true,
    activities,
    hasMore,
    nextCursor,
  });
}