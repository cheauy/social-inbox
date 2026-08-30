import { readWorkspaceStorage } from "@/lib/display/workspace-storage";

export const WORKSPACE_THEME_STORAGE_KEY =
  "tenh-display-workspace-theme";
export const WORKSPACE_THEME_CHANGE_EVENT =
  "tenh:display-theme-change";

export type WorkspaceThemeId = "light" | "dark" | "dim";

export type WorkspaceThemeOption = {
  id: WorkspaceThemeId;
  name: string;
  description: string;
  available: boolean;
};

export const workspaceThemes: WorkspaceThemeOption[] = [
  {
    id: "light",
    name: "Light",
    description: "Clean and bright for everyday productivity",
    available: true,
  },
  {
    id: "dark",
    name: "Dark",
    description: "Easy on the eyes in low light",
    available: false,
  },
  {
    id: "dim",
    name: "Dim",
    description: "Softer dark theme for extended use",
    available: false,
  },
];

export const DEFAULT_WORKSPACE_THEME_ID: WorkspaceThemeId =
  "light";

export function isWorkspaceThemeId(
  value: string | null,
): value is WorkspaceThemeId {
  return workspaceThemes.some((theme) => theme.id === value);
}

export function isAvailableWorkspaceThemeId(
  value: string | null,
): value is WorkspaceThemeId {
  return workspaceThemes.some(
    (theme) => theme.id === value && theme.available,
  );
}

export function getStoredWorkspaceThemeId(): WorkspaceThemeId {
  if (typeof window === "undefined") {
    return DEFAULT_WORKSPACE_THEME_ID;
  }

  const stored = readWorkspaceStorage(
    WORKSPACE_THEME_STORAGE_KEY,
  );

  return isAvailableWorkspaceThemeId(stored)
    ? stored
    : DEFAULT_WORKSPACE_THEME_ID;
}

export function applyWorkspaceTheme(id: WorkspaceThemeId) {
  if (typeof document === "undefined") {
    return;
  }

  // Dark and Dim are intentionally unavailable for now.
  // Force Light even if an older browser has a stale saved value.
  const safeTheme: WorkspaceThemeId =
    isAvailableWorkspaceThemeId(id)
      ? id
      : DEFAULT_WORKSPACE_THEME_ID;

  document.documentElement.dataset.tenhWorkspaceTheme = safeTheme;
  document.documentElement.style.colorScheme = "light";
}
