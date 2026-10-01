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
export function sanitizeFilters(
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
export function restrictFiltersToBusinesses(
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
