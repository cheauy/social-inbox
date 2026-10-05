import type { Member, Workspace } from "./types";

/** Permissions belong to a membership, never the previously selected workspace. */
export function canManageWorkspacePermission(
  workspace: Pick<Workspace, "memberId" | "subscriptionOperational"> | null,
  member: Pick<Member, "id" | "role"> | null,
  permissions: Record<string, string | boolean>,
  key: string,
) {
  return Boolean(
    workspace?.subscriptionOperational && member?.id === workspace.memberId &&
      (member.role === "owner" || permissions[key] === "manage"),
  );
}
