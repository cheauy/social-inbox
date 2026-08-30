import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  getInboxConversationScope,
} from "@/lib/inbox/get-conversations";
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
    "telegram",
  ]);

type WorkspaceScope =
  | "all"
  | "current"
  | "selected";

type SavedViewFilters = {
  workspaceScope: WorkspaceScope;
  workspaceIds: string[];
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
    | "comment"
    | "telegram";
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

function sanitizeWorkspaceIds(
  value: unknown,
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter(
          (item): item is string =>
            typeof item === "string" &&
            item.trim().length > 0,
        )
        .map((item) => item.trim()),
    ),
  ).slice(0, 30);
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

  const rawWorkspaceScope =
    typeof record.workspaceScope === "string"
      ? record.workspaceScope
      : typeof record.workspace_scope === "string"
        ? record.workspace_scope
        : "all";

  const workspaceScope: WorkspaceScope =
    ["all", "current", "selected"].includes(rawWorkspaceScope)
      ? (rawWorkspaceScope as WorkspaceScope)
      : "all";

  const workspaceIds = sanitizeWorkspaceIds(
    record.workspaceIds ??
      record.workspace_ids ??
      record.businessIds ??
      record.business_ids,
  );

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
    workspaceScope,
    workspaceIds,
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
      record.unreadOnly === true ||
      record.unread_only === true,

    pinnedOnly:
      record.pinnedOnly === true ||
      record.pinned_only === true,

    tagIds:
      sanitizeTagIds(
        record.tagIds ??
          record.tag_ids ??
          record.tags,
      ),
  };
}


function restrictFiltersToBusinesses(
  filters: SavedViewFilters,
  businessIds: string[],
): SavedViewFilters {
  const allowed = new Set(businessIds);

  return {
    ...filters,
    workspaceIds: filters.workspaceIds.filter((businessId) =>
      allowed.has(businessId),
    ),
    tagIds: filters.tagIds.filter((reference) => {
      const separatorIndex = reference.indexOf("::");

      if (separatorIndex <= 0) {
        // Legacy plain tag IDs are safe: Inbox matching is still restricted to
        // authorized conversations before this preference is applied.
        return true;
      }

      const businessId = reference.slice(0, separatorIndex).trim();
      return Boolean(businessId && allowed.has(businessId));
    }),
  };
}

type SmartViewMembership = {
  id: string;
  business_id: string;
};

async function loadAccessibleSmartViewMemberships(
  userId: string,
) {
  const scope = await getInboxConversationScope();

  if (scope.accessibleBusinessIds.length === 0) {
    return {
      scope,
      memberships: [] as SmartViewMembership[],
    };
  }

  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select("id,business_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .in("business_id", scope.accessibleBusinessIds);

  if (error) {
    throw new Error(
      `Unable to load Smart View memberships: ${error.message}`,
    );
  }

  return {
    scope,
    memberships: (data ?? []) as SmartViewMembership[],
  };
}

function smartViewAccessError(error: unknown) {
  return NextResponse.json(
    {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to verify Smart View access.",
    },
    { status: 500 },
  );
}

export async function GET() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  let access;

  try {
    access = await loadAccessibleSmartViewMemberships(
      authResult.user.id,
    );
  } catch (error) {
    return smartViewAccessError(error);
  }

  const memberIds = access.memberships.map(
    (membership) => membership.id,
  );
  const businessIds = access.memberships.map(
    (membership) => membership.business_id,
  );

  if (memberIds.length === 0 || businessIds.length === 0) {
    return NextResponse.json({
      success: true,
      businessId: authResult.member.business_id,
      memberId: authResult.member.id,
      views: [],
    });
  }

  const { data, error } = await supabaseAdmin
    .from("inbox_saved_views")
    .select(`
      id,
      name,
      filters,
      sort_index,
      created_at,
      updated_at
    `)
    .in("business_id", businessIds)
    .in("member_id", memberIds)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(
      "[Tenh Smart Views] Unable to load personal views:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error: "Unable to load Smart Views.",
        details: error.message,
        hint: "Run supabase/01-v3-1-smart-views.sql first.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    businessId: authResult.member.business_id,
    memberId: authResult.member.id,
    views: (data ?? []).map((view) => ({
      ...view,
      filters: sanitizeFilters(view.filters),
    })),
  });
}

export async function POST(
  request: NextRequest,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request." },
      { status: 400 },
    );
  }

  const name = sanitizeName(body.name);

  if (!name) {
    return NextResponse.json(
      { success: false, error: "View name is required." },
      { status: 400 },
    );
  }

  let filters = sanitizeFilters(body.filters);

  if (
    filters.workspaceScope === "selected" &&
    filters.workspaceIds.length === 0
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Select at least one workspace for this Smart View.",
      },
      { status: 400 },
    );
  }

  let access;

  try {
    access = await loadAccessibleSmartViewMemberships(
      authResult.user.id,
    );
  } catch (error) {
    return smartViewAccessError(error);
  }

  const memberIds = access.memberships.map(
    (membership) => membership.id,
  );
  const businessIds = access.memberships.map(
    (membership) => membership.business_id,
  );

  filters = restrictFiltersToBusinesses(filters, businessIds);

  if (
    filters.workspaceScope === "selected" &&
    filters.workspaceIds.length === 0
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Select at least one accessible workspace for this Smart View.",
      },
      { status: 400 },
    );
  }

  if (memberIds.length === 0 || businessIds.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: "No active TENH workspace is available for Smart Views.",
      },
      { status: 403 },
    );
  }

  const storageMembership =
    access.memberships.find(
      (membership) =>
        membership.business_id === authResult.member.business_id,
    ) ?? access.memberships[0];

  const { data: existingViews, error: existingViewsError } =
    await supabaseAdmin
      .from("inbox_saved_views")
      .select("id,name")
      .in("business_id", businessIds)
      .in("member_id", memberIds)
      .limit(21);

  if (existingViewsError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to validate Smart View limit.",
        details: existingViewsError.message,
      },
      { status: 500 },
    );
  }

  const currentViews = existingViews ?? [];

  if (currentViews.length >= 20) {
    return NextResponse.json(
      {
        success: false,
        error: "You can save up to 20 Smart Views.",
      },
      { status: 400 },
    );
  }

  if (
    currentViews.some(
      (view) =>
        String(view.name ?? "")
          .trim()
          .toLowerCase() === name.toLowerCase(),
    )
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "You already have a Smart View with this name.",
      },
      { status: 409 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("inbox_saved_views")
    .insert({
      business_id: storageMembership.business_id,
      member_id: storageMembership.id,
      name,
      filters,
      sort_index: currentViews.length,
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
    if (error.code === "23505") {
      return NextResponse.json(
        {
          success: false,
          error: "You already have a Smart View with this name.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "Unable to create Smart View.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    view: {
      ...data,
      filters: sanitizeFilters(data.filters),
    },
  });
}
