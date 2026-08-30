export const TENH_ACTIVE_WORKSPACE_UI_STORAGE_KEY =
  "tenh-active-workspace-ui";
export const TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT =
  "tenh:active-workspace-ui-change";

export function getActiveWorkspaceUiId() {
  if (typeof window === "undefined") return "default";
  return (
    window.localStorage.getItem(TENH_ACTIVE_WORKSPACE_UI_STORAGE_KEY)?.trim() ||
    "default"
  );
}

export function getWorkspaceScopedStorageKey(baseKey: string) {
  return `${baseKey}:${getActiveWorkspaceUiId()}`;
}

export function readWorkspaceStorage(baseKey: string) {
  if (typeof window === "undefined") return null;

  const scopedKey = getWorkspaceScopedStorageKey(baseKey);
  const scopedValue = window.localStorage.getItem(scopedKey);
  if (scopedValue !== null) return scopedValue;

  // One-time compatibility migration from the previous global key.
  const legacyValue = window.localStorage.getItem(baseKey);
  if (legacyValue !== null) {
    window.localStorage.setItem(scopedKey, legacyValue);
  }
  return legacyValue;
}

export function writeWorkspaceStorage(baseKey: string, value: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getWorkspaceScopedStorageKey(baseKey), value);
}

export function removeWorkspaceStorage(baseKey: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getWorkspaceScopedStorageKey(baseKey));
}

export function setActiveWorkspaceUiId(businessId: string | null | undefined) {
  if (typeof window === "undefined") return;

  const normalized = businessId?.trim() || "default";
  const previous = getActiveWorkspaceUiId();

  if (normalized === "default") {
    window.localStorage.removeItem(TENH_ACTIVE_WORKSPACE_UI_STORAGE_KEY);
  } else {
    window.localStorage.setItem(TENH_ACTIVE_WORKSPACE_UI_STORAGE_KEY, normalized);
  }

  if (previous !== normalized) {
    window.dispatchEvent(
      new CustomEvent(TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT, {
        detail: { businessId: normalized === "default" ? null : normalized },
      }),
    );
  }
}
