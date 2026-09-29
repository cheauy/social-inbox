import type { InboxConversation } from "@/types/inbox";
import { rowTime, uuidPattern } from "@/lib/inbox/live-sync";

export type ReadTarget = { id: string; lastMessageAt: string | null; updatedAt: string | null; unreadCount: number };
export type ReadReceipt = { id: string; last_message_at: string | null; updated_at: string | null; unread_count: number };
export type BulkReadResult = { marked: number; skipped: number; failed: number };
const validTime = (value: unknown) => value === null || typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$/.test(value) && Number.isFinite(Date.parse(value));

export function validReadTarget(value: unknown): value is ReadTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  return typeof target.id === "string" && uuidPattern.test(target.id) && validTime(target.lastMessageAt) &&
    validTime(target.updatedAt) && Number.isSafeInteger(target.unreadCount) && Number(target.unreadCount) > 0;
}
export function snapshotUnread(conversations: readonly InboxConversation[]): ReadTarget[] {
  const seen = new Set<string>();
  return conversations.filter(row => row.unread_count > 0 && !seen.has(row.id) && !!seen.add(row.id)).map(row => ({
    id: row.id, lastMessageAt: row.last_message_at, updatedAt: row.updated_at ?? null, unreadCount: row.unread_count,
  }));
}
/** Only used AFTER input validation. Compare all observed fields, not just ID. */
export function readSnapshotCondition(target: ReadTarget, databaseVersion: string | null): string {
  const time = target.lastMessageAt ? `last_message_at.eq.${target.lastMessageAt}` : "last_message_at.is.null";
  const version = target.updatedAt ?? databaseVersion;
  return `and(id.eq.${target.id},${time},unread_count.eq.${target.unreadCount}${version ? `,updated_at.eq.${version}` : ""})`;
}
export function receiptStillApplies(local: InboxConversation, receipt: ReadReceipt, target: ReadTarget): boolean {
  return local.id === receipt.id && rowTime(local.last_message_at) <= rowTime(target.lastMessageAt) &&
    rowTime(local.updated_at) <= rowTime(receipt.updated_at) && local.unread_count <= target.unreadCount;
}
