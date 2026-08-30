/**
 * TENH permission model.
 *
 * Two shapes of permission:
 *  - "level"  → none | view | manage   (graded access)
 *  - "toggle" → on | off               (a single capability)
 *
 * Rules that are NOT configurable, by design:
 *
 *  - An Owner always has everything. Owner rows ignore stored overrides,
 *    so nobody can lock the Owner out of their own workspace.
 *
 *  - Permissions only apply INSIDE the workspace they are stored for. A
 *    member restricted under one Owner who later buys their own
 *    subscription becomes Owner of their own workspace and has full
 *    access there — nothing carries across.
 *
 *  - Some things are ALWAYS allowed and deliberately have no entry here,
 *    because gating them would stop a member doing their job:
 *      · reading and replying in the shared inbox
 *      · viewing and editing customer records and notes
 *      · applying and removing existing tags and quick replies
 *      · personal settings — General, Display, Change history,
 *        Login & security, Active sessions. These only ever affect the
 *        member's own interface or their own account, never the
 *        workspace, so there is nothing to restrict.
 */

export type PermissionLevel = "none" | "view" | "manage";

export type PermissionKind = "level" | "toggle";

export type PermissionValue = PermissionLevel | boolean;

export type PermissionDefinition = {
  key: string;
  kind: PermissionKind;
  label: string;
  description: string;
  /** Locked permissions are always granted and cannot be edited. */
  locked?: boolean;
  /**
   * Levels this permission may be set to. Omit for the full set.
   * Billing omits "none" because every member can always see the plan.
   */
  levels?: PermissionLevel[];
  /** Shown in the UI under the "view" level, explaining the limit. */
  viewNotice?: string;
  ownerDefault: PermissionValue;
  teamDefault: PermissionValue;
};

export type PermissionGroup = {
  key: string;
  title: string;
  description: string;
  icon: "tag" | "member" | "integration" | "billing";
  permissions: PermissionDefinition[];
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "content",
    title: "Tags & quick replies",
    description:
      "Everyone can use tags and quick replies in the inbox. This controls who can change the list.",
    icon: "tag",
    permissions: [
      {
        key: "tags_quick_replies",
        kind: "level",
        // "none" is intentionally absent: a member must always be able
        // to see the tags and quick replies they use in the inbox.
        levels: ["view", "manage"],
        label: "Tags & quick replies",
        description:
          "View shows the lists read-only — add, edit, disable and delete are unavailable. Manage allows changing them.",
        viewNotice:
          "Only an Owner, or a member given permission, can change tags and quick replies. You can still view them and use them in the inbox.",
        ownerDefault: "manage",
        teamDefault: "view",
      },
    ],
  },
  {
    key: "team",
    title: "Team members",
    description: "Who can see and change the people in this workspace.",
    icon: "member",
    permissions: [
      {
        key: "team_members",
        kind: "level",
        // "none" is intentionally absent: seeing who is in the workspace
        // is part of working in it.
        levels: ["view", "manage"],
        label: "People & Channel",
        description:
          "View lists the workspace members read-only. Manage allows inviting, deactivating and removing them.",
        viewNotice:
          "Only an Owner, or a member given permission, can change subscription access, Owner permissions, or channel capacity. You can still review the current settings.",
        ownerDefault: "manage",
        teamDefault: "view",
      },
      {
        key: "roles_permissions",
        kind: "level",
        levels: ["view", "manage"],
        label: "Roles & permissions",
        description:
          "View shows what each member is allowed to do. Manage allows changing it.",
        ownerDefault: "manage",
        teamDefault: "view",
      },
    ],
  },
  {
    key: "channels",
    title: "Channels & integrations",
    description: "Connected messaging channels.",
    icon: "integration",
    permissions: [
      {
        key: "channels",
        kind: "level",
        levels: ["view", "manage"],
        label: "Channels & integrations",
        description:
          "View shows connected channels read-only. Manage allows connecting, reconnecting and disconnecting.",
        ownerDefault: "manage",
        teamDefault: "view",
      },
    ],
  },
  {
    key: "billing",
    title: "Subscription & billing",
    description: "Plan, invoices and payments.",
    icon: "billing",
    permissions: [
      {
        key: "billing",
        kind: "level",
        // "none" is intentionally absent: every member can always see the
        // workspace plan and expiry, because it explains why access may
        // be locked.
        levels: ["view", "manage"],
        label: "Subscription & billing",
        description:
          "View shows the plan, usage and invoices. Manage allows changing plan, capacity, payment method and renewal.",
        viewNotice:
          "Only an Owner can change subscription access, Owner permissions, or channel capacity. You can still review the current settings.",
        ownerDefault: "manage",
        teamDefault: "view",
      },
    ],
  },
];

export const PERMISSION_DEFINITIONS: PermissionDefinition[] =
  PERMISSION_GROUPS.flatMap((group) => group.permissions);

const DEFINITION_BY_KEY = new Map(
  PERMISSION_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export type EffectivePermissions = Record<string, PermissionValue>;

const LEVEL_RANK: Record<PermissionLevel, number> = {
  none: 0,
  view: 1,
  manage: 2,
};

/**
 * Keys that were configurable in an earlier version and are now always
 * allowed. Stored rows may still contain them, and guards may still be
 * removed gradually, so they resolve to full access instead of being
 * treated as unknown (which would deny).
 */
const ALWAYS_ALLOWED_KEYS = new Set([
  "conversations",
  "customers",
  "billing_view",
  "settings_general",
  "settings_display",
  "settings_history",
  "settings_security",
  "settings_activity",
]);

export function isOwnerRole(role: string | null | undefined) {
  return role === "owner";
}

export function allowedLevels(
  definition: PermissionDefinition,
): PermissionLevel[] {
  return definition.levels ?? ["none", "view", "manage"];
}

function defaultValue(
  definition: PermissionDefinition,
  role: string | null | undefined,
): PermissionValue {
  return isOwnerRole(role)
    ? definition.ownerDefault
    : definition.teamDefault;
}

function coerce(
  definition: PermissionDefinition,
  raw: unknown,
  fallback: PermissionValue,
): PermissionValue {
  if (definition.kind === "toggle") {
    return typeof raw === "boolean" ? raw : fallback;
  }

  const levels = allowedLevels(definition);

  return typeof raw === "string" &&
    (levels as string[]).includes(raw)
    ? (raw as PermissionLevel)
    : fallback;
}

/**
 * Turn a stored overrides blob into the full permission set for a member.
 * Unknown keys in storage are ignored, missing keys fall back to the role
 * default, and locked permissions always win.
 */
export function resolvePermissions(
  role: string | null | undefined,
  stored: unknown,
): EffectivePermissions {
  const overrides =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};

  const resolved: EffectivePermissions = {};

  for (const definition of PERMISSION_DEFINITIONS) {
    const fallback = defaultValue(definition, role);

    if (definition.locked) {
      resolved[definition.key] =
        definition.kind === "toggle" ? true : "manage";
      continue;
    }

    // An Owner is never restricted by stored overrides.
    if (isOwnerRole(role)) {
      resolved[definition.key] = definition.ownerDefault;
      continue;
    }

    resolved[definition.key] = coerce(
      definition,
      overrides[definition.key],
      fallback,
    );
  }

  // Retired keys resolve to full access so any guard still referencing
  // one keeps working while it is being removed.
  for (const key of ALWAYS_ALLOWED_KEYS) {
    resolved[key] = "manage";
  }

  return resolved;
}

export function defaultPermissionsForRole(
  role: string | null | undefined,
): EffectivePermissions {
  return resolvePermissions(role, {});
}

/**
 * Does this permission set allow `key` at `required` level?
 * For toggles, `required` is ignored — the toggle either grants or not.
 */
export function hasPermission(
  permissions: EffectivePermissions,
  key: string,
  required: PermissionLevel = "manage",
) {
  if (ALWAYS_ALLOWED_KEYS.has(key)) {
    return true;
  }

  const definition = DEFINITION_BY_KEY.get(key);

  if (!definition) {
    // Unknown key: deny rather than silently allow.
    return false;
  }

  const value = permissions[key];

  if (definition.kind === "toggle") {
    return value === true;
  }

  const current =
    value === "none" || value === "view" || value === "manage"
      ? value
      : "none";

  return LEVEL_RANK[current] >= LEVEL_RANK[required];
}

/**
 * Strip anything that is not a real, editable permission before storing.
 * Locked values, retired keys and out-of-range levels are dropped so they
 * can never be persisted in a weakened form.
 */
export function sanitizePermissionInput(
  input: unknown,
): EffectivePermissions {
  const raw =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const cleaned: EffectivePermissions = {};

  for (const definition of PERMISSION_DEFINITIONS) {
    if (definition.locked) {
      continue;
    }

    cleaned[definition.key] = coerce(
      definition,
      raw[definition.key],
      definition.teamDefault,
    );
  }

  return cleaned;
}
