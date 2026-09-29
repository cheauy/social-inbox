import type { InboxConversation } from "@/types/inbox";

/** Bounds shared by the background safety net and its authenticated API. */
export const INBOX_SYNC_EVENT = "tenh-inbox-resync";
export const KNOWN_SYNC_BATCH = 200;
export const DISCOVERY_BATCH = 100;
export const SYNC_TIMEOUT_MS = 15_000;
export type InboxSyncCursor = { updatedAt: string; id?: string };
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validSyncCursor(value: unknown): value is InboxSyncCursor {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.updatedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$/.test(row.updatedAt) && Number.isFinite(Date.parse(row.updatedAt)) &&
    (row.id === undefined || typeof row.id === "string" && uuidPattern.test(row.id));
}
export function takeSyncBatch<T>(rows: T[], offset: number): { rows: T[]; nextOffset: number } {
  if (!rows.length) return { rows: [], nextOffset: 0 };
  const start = offset < rows.length ? offset : 0;
  return { rows: rows.slice(start, start + KNOWN_SYNC_BATCH), nextOffset: start + KNOWN_SYNC_BATCH >= rows.length ? 0 : start + KNOWN_SYNC_BATCH };
}
export function rowTime(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) || 0 : 0;
}
/** A late HTTP response must not roll back a newer WebSocket event or read. */
export function isOlderConversationState(local: { updated_at?: string | null; last_message_at?: string | null }, remote: { updated_at?: string | null; last_message_at?: string | null }) {
  const localVersion = rowTime(local.updated_at), remoteVersion = rowTime(remote.updated_at);
  if (remoteVersion > 0 && localVersion > remoteVersion) return true;
  const messageDrift = rowTime(local.last_message_at) - rowTime(remote.last_message_at);
  // Telegram timestamps may omit milliseconds while the optimistic preview has
  // them. A strictly newer database version can reconcile that sub-second gap.
  return messageDrift > 0 && !(messageDrift < 1_000 && remoteVersion > localVersion);
}

export function liveMessageType(value: unknown): InboxConversation["latest_message_type"] {
  return typeof value === "string" && ["text", "image", "video", "audio", "file", "sticker", "unknown"].includes(value)
    ? value as InboxConversation["latest_message_type"] : null;
}

/** Provider timestamps can have only second precision. A row inserted after
 * the read acknowledgement is new even when platform_created_at is equal. */
export function messageCoveredByRead(platformAt: unknown, createdAt: unknown, barrier: number, readVersion: number): boolean {
  return barrier > 0 && rowTime(platformAt) <= barrier &&
    !(readVersion > 0 && rowTime(createdAt) > readVersion);
}
