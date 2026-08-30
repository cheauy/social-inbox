"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type PermissionLevel = "none" | "view" | "manage";
export type PermissionValue = PermissionLevel | boolean;
export type PermissionMap = Record<string, PermissionValue>;

type PermissionsState = {
  permissions: PermissionMap;
  isOwner: boolean;
  loading: boolean;
  /**
   * True once the server has answered. Until then `can()` returns true so
   * the UI does not flash-hide menus that the member is allowed to see.
   */
  loaded: boolean;
  refresh: () => Promise<void>;
};

const PermissionsContext = createContext<PermissionsState | null>(null);

const LEVEL_RANK: Record<PermissionLevel, number> = {
  none: 0,
  view: 1,
  manage: 2,
};

function checkPermission(
  permissions: PermissionMap,
  key: string,
  required: PermissionLevel,
) {
  const value = permissions[key];

  if (typeof value === "boolean") {
    return value;
  }

  const current =
    value === "none" || value === "view" || value === "manage"
      ? value
      : "none";

  return LEVEL_RANK[current] >= LEVEL_RANK[required];
}

export function WorkspacePermissionsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      // POST on this endpoint returns the CALLER's own effective
      // permissions, unlike GET which needs roles_permissions:view.
      const response = await fetch("/api/team/permissions", {
        method: "POST",
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const result = (await response.json()) as {
        success?: boolean;
        isOwner?: boolean;
        permissions?: PermissionMap;
      };

      if (!result.success) {
        return;
      }

      setPermissions(result.permissions ?? {});
      setIsOwner(result.isOwner === true);
      setLoaded(true);
    } catch {
      // Leave `loaded` false so the UI stays permissive. The server is
      // what actually enforces access; hiding things on a failed fetch
      // would lock people out of pages they can use.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ permissions, isOwner, loading, loaded, refresh }),
    [permissions, isOwner, loading, loaded, refresh],
  );

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

/**
 * Read the current member's permissions.
 *
 *   const { can, isOwner } = useWorkspacePermissions();
 *   {can("channels", "manage") ? <ConnectButton /> : null}
 *
 * This is a CONVENIENCE, not a security boundary — every one of these
 * permissions is enforced server-side as well. Hiding a button only
 * stops the member being offered something that would 403.
 */
export function useWorkspacePermissions() {
  const context = useContext(PermissionsContext);

  const can = useCallback(
    (key: string, level: PermissionLevel = "manage") => {
      if (!context) {
        return true;
      }

      // Before the first answer, assume allowed. An owner always is.
      if (!context.loaded || context.isOwner) {
        return true;
      }

      return checkPermission(context.permissions, key, level);
    },
    [context],
  );

  return {
    can,
    isOwner: context?.isOwner ?? false,
    loading: context?.loading ?? false,
    loaded: context?.loaded ?? false,
    permissions: context?.permissions ?? {},
    refresh: context?.refresh ?? (async () => {}),
  };
}
