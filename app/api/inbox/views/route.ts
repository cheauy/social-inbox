import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

const ALLOWED_STATUSES =
  new Set([
    "any",
    "open",
    "pending",
    "resolved",
    "closed",
    "spam",
  ]);

const ALLOWED_ASSIGNMENTS =
  new Set([
    "any",
    "me",
    "assigned",
    "unassigned",
  ]);

const ALLOWED_CHANNELS =
  new Set([
    "any",
    "messenger",
    "comment",
  ]);

type SavedViewFilters = {
  status:
    | "any"
    | "open"
    | "pending"
    | "resolved"
    | "closed"
    | "spam";
  assignment:
    | "any"
    | "me"
    | "assigned"
    | "unassigned";
  channel:
    | "any"
    | "messenger"
    | "comment";
  unreadOnly: boolean;
  pinnedOnly: boolean;
  tagIds: string[];
};

function sanitizeName(
  value: unknown,
) {
  if (
    typeof value !==
    "string"
  ) {
    return "";
  }

  return value
    .trim()
    .replace(
      /\s+/g,
      " ",
    )
    .slice(0, 40);
}

function sanitizeTagIds(
  value: unknown,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter(
          (
            item,
          ): item is string =>
            typeof item ===
              "string" &&
            item.trim().length >
              0,
        )
        .map(
          (item) =>
            item.trim(),
        ),
    ),
  ).slice(0, 20);
}

function sanitizeFilters(
  value: unknown,
): SavedViewFilters {
  const record =
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(value)
      ? (value as
          Record<
            string,
            unknown
          >)
      : {};

  const rawStatus =
    typeof record.status ===
    "string"
      ? record.status
      : "any";

  const rawAssignment =
    typeof record.assignment ===
    "string"
      ? record.assignment
      : "any";

  const rawChannel =
    typeof record.channel ===
    "string"
      ? record.channel
      : "any";

  return {
    status:
      ALLOWED_STATUSES.has(
        rawStatus,
      )
        ? (rawStatus as
            SavedViewFilters["status"])
        : "any",

    assignment:
      ALLOWED_ASSIGNMENTS.has(
        rawAssignment,
      )
        ? (rawAssignment as
            SavedViewFilters["assignment"])
        : "any",

    channel:
      ALLOWED_CHANNELS.has(
        rawChannel,
      )
        ? (rawChannel as
            SavedViewFilters["channel"])
        : "any",

    unreadOnly:
      record.unreadOnly ===
      true,

    pinnedOnly:
      record.pinnedOnly ===
      true,

    tagIds:
      sanitizeTagIds(
        record.tagIds,
      ),
  };
}

export async function GET() {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          authResult.error,
      },
      {
        status:
          authResult.status,
      },
    );
  }

  const currentMember =
    authResult.member;

  const {
    data,
    error,
  } = await supabaseAdmin
    .from(
      "inbox_saved_views",
    )
    .select(`
      id,
      name,
      filters,
      sort_index,
      created_at,
      updated_at
    `)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq(
      "member_id",
      currentMember.id,
    )
    .order(
      "sort_index",
      {
        ascending: true,
      },
    )
    .order(
      "created_at",
      {
        ascending: true,
      },
    );

  if (error) {
    console.error(
      "[Tenh Smart Views V3.1] Unable to load views:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load Smart Views.",
        details:
          error.message,
        hint:
          "Run supabase/01-v3-1-smart-views.sql first.",
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    businessId:
      currentMember.business_id,
    memberId:
      currentMember.id,
    views:
      data ?? [],
  });
}

export async function POST(
  request: NextRequest,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          authResult.error,
      },
      {
        status:
          authResult.status,
      },
    );
  }

  const currentMember =
    authResult.member;

  let body:
    Record<
      string,
      unknown
    >;

  try {
    body =
      (await request.json()) as
        Record<
          string,
          unknown
        >;
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          "Invalid JSON request.",
      },
      {
        status: 400,
      },
    );
  }

  const name =
    sanitizeName(
      body.name,
    );

  if (!name) {
    return NextResponse.json(
      {
        success: false,
        error:
          "View name is required.",
      },
      {
        status: 400,
      },
    );
  }

  const filters =
    sanitizeFilters(
      body.filters,
    );

  const {
    count,
    error:
      countError,
  } = await supabaseAdmin
    .from(
      "inbox_saved_views",
    )
    .select(
      "id",
      {
        count: "exact",
        head: true,
      },
    )
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .eq(
      "member_id",
      currentMember.id,
    );

  if (countError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to validate Smart View limit.",
        details:
          countError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (
    (count ?? 0) >=
    20
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "You can save up to 20 Smart Views.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data,
    error,
  } = await supabaseAdmin
    .from(
      "inbox_saved_views",
    )
    .insert({
      business_id:
        currentMember.business_id,
      member_id:
        currentMember.id,
      name,
      filters,
      sort_index:
        count ?? 0,
    })
    .select(`
      id,
      name,
      filters,
      sort_index,
      created_at,
      updated_at
    `)
    .single();

  if (error) {
    if (
      error.code ===
      "23505"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "You already have a Smart View with this name.",
        },
        {
          status: 409,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to create Smart View.",
        details:
          error.message,
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    view: data,
  });
}
