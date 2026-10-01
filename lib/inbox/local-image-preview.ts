import type { InboxMessage } from "@/types/inbox";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const blob = (value: unknown): value is string => typeof value === "string" && value.startsWith("blob:");
export type LocalImagePreview = { __local_image_preview?: string; __local_album_previews?: Record<string, string> };

/** Client-only preview state. Keep the server URL/album metadata authoritative;
 * blobs are never written into the provider attachment payload. */
export function retainLocalImagePreview<T extends InboxMessage & { business_id?: string }>(saved: T, local: InboxMessage & { business_id?: string }): T & LocalImagePreview {
  const result = { ...saved } as T & LocalImagePreview;
  if (record(saved.raw_payload).tenh_deleted || saved.comment_is_deleted) {
    delete result.__local_image_preview; delete result.__local_album_previews; return result;
  }
  if (saved.business_id && local.business_id && saved.business_id !== local.business_id || saved.conversation_id !== local.conversation_id ||
      saved.direction !== "outgoing" || local.direction !== "outgoing" || saved.message_type !== "image" || local.message_type !== "image" ||
      !(local.id.startsWith("optimistic:") || saved.platform_message_id === local.platform_message_id)) return result;
  const previous = local as InboxMessage & LocalImagePreview;
  const attachments = record(record(local.raw_payload).message).attachments;
  const previews = previous.__local_album_previews ?? (Array.isArray(attachments) ? Object.fromEntries(attachments.flatMap((item, index) => {
    const url = record(record(item).payload).url; return record(item).type === "image" && blob(url) ? [[String(index), url]] : [];
  })) : {});
  if (Object.keys(previews).length) result.__local_album_previews = previews;
  const indices = record(record(saved.raw_payload).tenh_image_album).saved_indices;
  const first = Array.isArray(indices) && Number.isSafeInteger(indices[0]) ? String(indices[0]) : "0";
  const preview = previews[first] ?? previous.__local_image_preview ?? local.attachment_url;
  if (blob(preview)) result.__local_image_preview = preview;
  return result;
}

export function localImagePreview(message: Pick<InboxMessage, "id" | "raw_payload"> & LocalImagePreview): string | undefined {
  const index = /:photo:(\d+)$/.exec(message.id)?.[1];
  if (index != null) {
    const saved = record(record(message.raw_payload).tenh_image_album).saved_indices;
    const original = Array.isArray(saved) && Number.isSafeInteger(saved[Number(index)]) ? String(saved[Number(index)]) : index;
    return message.__local_album_previews?.[original];
  }
  return message.__local_image_preview;
}
