import type { InboxConversation } from "@/types/inbox";
import type { ReadTarget } from "@/lib/inbox/bulk-read";
import { uuidPattern, isOlderConversationState } from "@/lib/inbox/live-sync";

export const CONVERSATION_PAGE_SIZE = 30;
export const INBOX_PAGE_CHANGED_EVENT = "tenh:inbox-page-changed";
export type ConversationCursor = { id: string; pinned: boolean; lastMessageAt: string | null };
export type ConversationPageRequest = {
  status: string; view: string; search: string; channelId: string | null;
  workspaceId: string | null; workspaceContextId: string | null;
  cursor: ConversationCursor | null;
  knownIds?: string[];
};
export type ConversationPageCounts = {
  views: Record<string, number>;
  statusCounts: Record<"all" | "open" | "pending" | "resolved" | "closed" | "spam", number>;
  totalUnreadCount: number; unreadConversationCount: number;
};
export type ConversationPage = {
  conversations: InboxConversation[]; total: number; hasMore: boolean;
  cursor: ConversationCursor | null; counts: ConversationPageCounts;
  readTargets: ReadTarget[];
  matchedKnownIds: string[];
  updates: InboxConversation[];
};

export function parseConversationPageRequest(value: unknown): ConversationPageRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid page request.");
  const body = value as Record<string, unknown>;
  const status = body.status ?? "all", view = body.view ?? "all", search = body.search ?? "";
  if (typeof status !== "string" || !["all","open","pending","resolved","closed","spam"].includes(status)) throw new Error("Invalid status.");
  if (typeof view !== "string" || !(["all","unread","my","unassigned","comment","open","pinned"].includes(view) || view.startsWith("saved:") && uuidPattern.test(view.slice(6)))) throw new Error("Invalid view.");
  if (typeof search !== "string" || search.length > 500) throw new Error("Search must be at most 500 characters.");
  const id = (key: string) => {
    if (body[key] == null || body[key] === "") return null;
    if (typeof body[key] !== "string" || !uuidPattern.test(body[key] as string)) throw new Error(`Invalid ${key}.`);
    return body[key] as string;
  };
  let cursor: ConversationCursor | null = null;
  if (body.cursor != null) {
    const c = body.cursor as Record<string, unknown>;
    if (typeof c !== "object" || typeof c.id !== "string" || !uuidPattern.test(c.id) || typeof c.pinned !== "boolean" ||
      !(c.lastMessageAt === null || typeof c.lastMessageAt === "string" && /^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$/.test(c.lastMessageAt) && Number.isFinite(Date.parse(c.lastMessageAt)))) throw new Error("Invalid page cursor.");
    cursor = { id: c.id, pinned: c.pinned, lastMessageAt: c.lastMessageAt as string | null };
  }
  const knownIds = body.knownIds ?? [];
  if (!Array.isArray(knownIds) || knownIds.length > 200 || knownIds.some(value => typeof value !== "string" || !uuidPattern.test(value))) throw new Error("Invalid known conversation IDs.");
  return { status, view, search: search.trim(), channelId: id("channelId"), workspaceId: id("workspaceId"), workspaceContextId: id("workspaceContextId"), cursor, ...(knownIds.length ? { knownIds: [...new Set(knownIds)] } : {}) };
}

export function sortConversationPage(rows: InboxConversation[]) {
  return [...rows].sort((a,b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned)) ||
    (b.last_message_at ? Date.parse(b.last_message_at) : -Infinity) - (a.last_message_at ? Date.parse(a.last_message_at) : -Infinity) || b.id.localeCompare(a.id));
}

// Preserve a newer realtime/read version when a slower page response arrives.
export function mergeConversationPage(local: InboxConversation[], incoming: InboxConversation[]) {
  const byId = new Map(local.map(row => [row.id,row]));
  for (const row of incoming) {
    const current = byId.get(row.id);
    if (!current || !isOlderConversationState(current,row)) byId.set(row.id,row);
  }
  return sortConversationPage([...byId.values()]);
}

export type ConversationPagingInitial = { request: ConversationPageRequest; page: Omit<ConversationPage,"conversations" | "readTargets" | "updates" | "matchedKnownIds"> & { ids: string[] } };
