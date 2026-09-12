import type { InboxMessage } from "@/types/inbox";

const receiptRank = (value: unknown) => value === "seen" ? 3 : value === "delivered" ? 2 : value === "sent" ? 1 : 0;
const key = (message: InboxMessage) => JSON.stringify([
  message.conversation_id,
  message.platform_message_id || message.id,
]);

function merge(first: InboxMessage, second: InboxMessage): InboxMessage {
  // Stored rows own identity and content. A temporary preview must never
  // overwrite a stored message just because the send request finished later.
  const secondIsTemporary = second.id.startsWith("optimistic:");
  const preferred = secondIsTemporary && !first.id.startsWith("optimistic:") ? first : second;
  const other = preferred === first ? second : first;
  const result = {
    ...other, ...preferred,
    attachment_url: preferred.attachment_url || other.attachment_url,
  } as InboxMessage & { __optimistic_status?: string; __optimistic_created_at?: number };
  const stronger = receiptRank(first.delivery_status) > receiptRank(second.delivery_status) ? first : second;
  result.delivery_status = stronger.delivery_status;
  result.seen_at = stronger.seen_at ?? result.seen_at;
  result.delivered_at = stronger.delivered_at ?? result.delivered_at;
  if (!result.id.startsWith("optimistic:")) {
    delete result.__optimistic_status;
    delete result.__optimistic_created_at;
  }
  return result;
}

/** One row per platform message, across responses, polling, caches and Realtime. */
export function normalizeMessages(next: InboxMessage[], previous: InboxMessage[] = []): InboxMessage[] {
  const previousByKey = new Map(previous.map((message) => [key(message), message]));
  const rows: InboxMessage[] = [];
  const indices = new Map<string, number>();
  for (const message of next) {
    const identity = key(message);
    const old = previousByKey.get(identity);
    const incoming = old ? merge(old, message) : message;
    const index = indices.get(identity);
    if (index === undefined) {
      indices.set(identity, rows.length);
      rows.push(incoming);
    } else {
      rows[index] = merge(rows[index], incoming);
    }
  }
  return rows;
}
