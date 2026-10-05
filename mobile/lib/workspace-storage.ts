import type { Pending } from "../components/composer";
import type { WorkspaceStorageFile, WorkspaceStorageSnapshot } from "../../lib/storage/workspace-storage-cache";
import { WORKSPACE_FILE_MAX_BYTES, workspaceFilesForView, type WorkspaceStorageView } from "../../lib/storage/workspace-files";

export type { WorkspaceStorageFile, WorkspaceStorageSnapshot, WorkspaceStorageView };
export const STORAGE_PAGE_SIZE = 30;
export const STORAGE_WINDOW_LIMIT = 150; // Five native pages; the cursor can continue past this window.

export function storageFiles(snapshot: WorkspaceStorageSnapshot, view: WorkspaceStorageView, kind: "media" | "files", query: string) {
  const effectiveView = snapshot.organizationAvailable ? view : "recent";
  const q = query.trim().toLowerCase();
  return workspaceFilesForView(snapshot.files, effectiveView).filter(file =>
    ((file.kind === "image" || file.kind === "video") === (kind === "media")) &&
    (!q || file.name.toLowerCase().includes(q)),
  );
}

export function storageFileName(file: WorkspaceStorageFile) {
  const safe = file.name.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "").slice(-120) || "workspace-file";
  if (/\.[a-z0-9]{2,6}$/i.test(safe)) return safe;
  const extension: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4", "video/quicktime": ".mov", "audio/mpeg": ".mp3", "audio/wav": ".wav", "application/pdf": ".pdf" };
  return safe + (extension[file.mimeType] ?? (file.kind === "image" ? ".jpg" : file.kind === "video" ? ".mp4" : ".bin"));
}

/** All-or-nothing staging; every abandoned copy belongs to this operation. */
export async function stageStorageFiles(files: WorkspaceStorageFile[], room: number, io: {
  isCurrent: () => boolean;
  getUrl: (file: WorkspaceStorageFile) => Promise<string>;
  download: (file: WorkspaceStorageFile, url: string) => Promise<Pending & { bytes: number }>;
  discard: () => void;
}) {
  const current = () => { if (!io.isCurrent()) throw new Error("Storage selection was cancelled."); };
  const staged: Pending[] = [];
  try {
    current();
    if (!files.length || files.length > Math.min(30, room)) throw new Error("Choose only as many files as the draft has room for (up to 30).");
    for (const file of files) {
      current();
      if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0 || file.sizeBytes > WORKSPACE_FILE_MAX_BYTES) throw new Error(`${file.name} has invalid Storage metadata.`);
      const url = await io.getUrl(file); // Renew the link; preview URLs expire.
      current();
      if (!url || new URL(url).protocol !== "https:") throw new Error("Storage returned an invalid secure file link.");
      const saved = await io.download(file, url);
      current();
      if (saved.bytes !== file.sizeBytes) throw new Error(`${file.name} did not match its Storage size. Reload Storage and try again.`);
      const { bytes: _bytes, ...pending } = saved;
      staged.push(pending);
    }
    current();
    return staged;
  } catch (error) { io.discard(); throw error; }
}
