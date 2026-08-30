"use client";

import type { ReactNode } from "react";

import {
  useWorkspacePermissions,
  type PermissionLevel,
} from "@/lib/auth/use-workspace-permissions";

/**
 * Hides a navigation item the member cannot open.
 *
 * This is a convenience, not a security boundary — the page behind the
 * link enforces the same permission server-side. It fails open while the
 * permission fetch is in flight so nothing flickers away.
 */
export function NavPermissionGate({
  permission,
  level = "view",
  children,
}: {
  permission: string;
  level?: PermissionLevel;
  children: ReactNode;
}) {
  const { can } = useWorkspacePermissions();

  if (!can(permission, level)) {
    return null;
  }

  return <>{children}</>;
}
