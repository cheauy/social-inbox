export const WORKSPACE_FILE_BUCKET =
  "tenh-workspace-files";

export const WORKSPACE_FILE_MAX_BYTES =
  20 * 1024 * 1024;

export const WORKSPACE_FILE_ACCEPT =
  "image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp,.zip,.rar,.7z,.json,.xml,.mp3,.wav";

export type WorkspaceFileKind =
  | "image"
  | "video"
  | "audio"
  | "file";

export type WorkspaceStorageView =
  | "recent"
  | "favorites"
  | "trash"
  | `category:${string}`;

export function workspaceFilesForView<
  T extends { createdAt: string; categoryId: string | null; favorite: boolean; deletedAt: string | null },
>(files: T[], view: WorkspaceStorageView) {
  const filtered = view === "trash"
    ? files.filter((file) => file.deletedAt)
    : view === "favorites"
    ? files.filter((file) => file.favorite && !file.deletedAt)
    : view.startsWith("category:")
      ? files.filter((file) => !file.deletedAt && file.categoryId === view.slice("category:".length))
      : files.filter((file) => !file.deletedAt);

  return [...filtered].sort(
    (left, right) =>
      (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0),
  );
}

const FILE_EXTENSION =
  /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|rtf|odt|ods|odp|zip|rar|7z|json|xml)$/i;

const AUDIO_EXTENSION = /\.(mp3|wav)$/i;

export function workspaceFileKind(
  fileName: string,
  mimeType: string,
): WorkspaceFileKind | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (AUDIO_EXTENSION.test(fileName)) return "audio";
  if (FILE_EXTENSION.test(fileName)) return "file";
  return null;
}

export function workspaceFilePath({
  businessId,
  fileId,
  fileName,
}: {
  businessId: string;
  fileId: string;
  fileName: string;
}) {
  const safeName = fileName
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .slice(0, 120) || "workspace-file";

  return `${businessId}/${fileId}-${safeName}`;
}

export function isWorkspaceFilePathOwned(
  path: string,
  businessId: string,
) {
  return path.startsWith(`${businessId}/`) &&
    !path.slice(businessId.length + 1).includes("/");
}
