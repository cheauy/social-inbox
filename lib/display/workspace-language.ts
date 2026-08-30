import { readWorkspaceStorage } from "@/lib/display/workspace-storage";

export const WORKSPACE_LANGUAGE_STORAGE_KEY =
  "tenh-display-language";
export const WORKSPACE_LANGUAGE_CHANGE_EVENT =
  "tenh:display-language-change";

export type WorkspaceLanguageId = "en" | "km";

export type WorkspaceLanguageOption = {
  id: WorkspaceLanguageId;
  name: string;
  nativeName: string;
  shortLabel: string;
  description: string;
};

export const workspaceLanguages: WorkspaceLanguageOption[] = [
  {
    id: "en",
    name: "English",
    nativeName: "English",
    shortLabel: "EN",
    description: "Use English across your TENH workspace.",
  },
  {
    id: "km",
    name: "Khmer",
    nativeName: "ភាសាខ្មែរ",
    shortLabel: "ខ្មែរ",
    description: "Use Khmer as your TENH workspace language.",
  },
];

export const DEFAULT_WORKSPACE_LANGUAGE_ID: WorkspaceLanguageId =
  "en";

export function isWorkspaceLanguageId(
  value: string | null,
): value is WorkspaceLanguageId {
  return value === "en" || value === "km";
}

export function getWorkspaceLanguage(
  id: WorkspaceLanguageId,
) {
  return (
    workspaceLanguages.find((language) => language.id === id) ??
    workspaceLanguages[0]
  );
}

export function getStoredWorkspaceLanguageId(): WorkspaceLanguageId {
  if (typeof window === "undefined") {
    return DEFAULT_WORKSPACE_LANGUAGE_ID;
  }

  const stored = readWorkspaceStorage(
    WORKSPACE_LANGUAGE_STORAGE_KEY,
  );

  return isWorkspaceLanguageId(stored)
    ? stored
    : DEFAULT_WORKSPACE_LANGUAGE_ID;
}

export function applyWorkspaceLanguage(
  id: WorkspaceLanguageId,
) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.lang = id === "km" ? "km" : "en";
  root.dir = "ltr";
  root.dataset.tenhLanguage = id;
}
