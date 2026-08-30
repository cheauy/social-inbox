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

type RouteContext = {
  params: Promise<{
    viewId: string;
  }>;
};

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
    return [] as SmartViewMembership[];
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

  return (data ?? []) as SmartViewMembership[];
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

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const { viewId } = await context.params;

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

  let memberships: SmartViewMembership[];

  try {
    memberships = await loadAccessibleSmartViewMemberships(
      authResult.user.id,
    );
  } catch (error) {
    return smartViewAccessError(error);
  }

  const memberIds = memberships.map((membership) => membership.id);
  const businessIds = memberships.map(
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
      { success: false, error: "Smart View was not found." },
      { status: 404 },
    );
  }

  const { data: existingNames, error: existingNamesError } =
    await supabaseAdmin
      .from("inbox_saved_views")
      .select("id,name")
      .in("business_id", businessIds)
      .in("member_id", memberIds)
      .neq("id", viewId)
      .limit(20);

  if (existingNamesError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to validate the Smart View name.",
        details: existingNamesError.message,
      },
      { status: 500 },
    );
  }

  if (
    (existingNames ?? []).some(
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
    .update({ name, filters })
    .eq("id", viewId)
    .in("business_id", businessIds)
    .in("member_id", memberIds)
    .select(`
      id,
      name,
      filters,
      sort_index,
      created_at,
      updated_at
    `)
    .maybeSingle();

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
        error: "Unable to update Smart View.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { success: false, error: "Smart View was not found." },
      { status: 404 },
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

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const { viewId } = await context.params;

  let memberships: SmartViewMembership[];

  try {
    memberships = await loadAccessibleSmartViewMemberships(
      authResult.user.id,
    );
  } catch (error) {
    return smartViewAccessError(error);
  }

  const memberIds = memberships.map((membership) => membership.id);
  const businessIds = memberships.map(
    (membership) => membership.business_id,
  );

  if (memberIds.length === 0 || businessIds.length === 0) {
    return NextResponse.json(
      { success: false, error: "Smart View was not found." },
      { status: 404 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("inbox_saved_views")
    .delete()
    .eq("id", viewId)
    .in("business_id", businessIds)
    .in("member_id", memberIds)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to delete Smart View.",
        details: error.message,
      },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { success: false, error: "Smart View was not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true });
}
