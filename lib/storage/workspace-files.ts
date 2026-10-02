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
