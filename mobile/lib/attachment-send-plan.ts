import type { Pending } from "../components/composer";

export const MAX_PENDING_ATTACHMENTS = 30;
// The existing deployment allows 4.5 MB per multipart request. Leave room for
// fields, boundaries and filename encoding; apply the budget after resizing.
export const REQUEST_BUDGET = 4_000_000;
export const MULTIPART_BASE = 64_000;
export const MULTIPART_ITEM = 8_000;
const channelLimits = { image: 10 * 1024 * 1024, video: 50 * 1024 * 1024, audio: 25 * 1024 * 1024, file: 25 * 1024 * 1024 };
export type SizedAttachment = Pending & { bytes: number };

export function attachmentIssue(file: SizedAttachment, platform: string): string | null {
  if (!Number.isFinite(file.bytes) || file.bytes <= 0) return "Could not read this file's size. Pick it again.";
  if (file.bytes > channelLimits[file.kind]) return "This file exceeds the channel's size limit.";
  if (file.bytes + MULTIPART_BASE + MULTIPART_ITEM > REQUEST_BUDGET) return "This file is too large for an upload. Choose a smaller clip or file (under 3.9 MB).";
  if (platform === "telegram" && file.kind === "video" && file.mimeType !== "video/mp4") return "Telegram videos must be MP4. Export an MP4 clip and pick it again.";
  if (platform === "telegram" && file.kind === "image" && !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.mimeType)) return "This image could not be converted to a supported Telegram photo.";
  return null;
}

// Preserve selection order. Messenger videos/documents are individual sends;
// Telegram combines photos and MP4 clips, and Messenger combines photos only.
export function attachmentBatches(files: SizedAttachment[], platform: string): SizedAttachment[][] {
  const batches: SizedAttachment[][] = [];
  for (const file of files) {
    const previous = batches.at(-1);
    const albumKind = (f: Pending) => platform === "telegram" ? f.kind === "image" || f.kind === "video" : f.kind === "image";
    const limit = platform === "telegram" ? 10 : 30;
    const fits = previous && albumKind(file) && previous.every(albumKind) && previous.length < limit &&
      MULTIPART_BASE + [...previous, file].reduce((sum, f) => sum + f.bytes + MULTIPART_ITEM, 0) <= REQUEST_BUDGET;
    if (fits) previous.push(file); else batches.push([file]);
  }
  return batches;
}
