import type { InboxMessage } from "@/types/inbox";

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const metadataTime = (value: unknown, key: string) => {
  const parsed = Date.parse(String(asRecord(value)[key] ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

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
  const oldPayload = asRecord(other.raw_payload);
  const newPayload = asRecord(preferred.raw_payload);
  const payload = { ...newPayload };
  // Never strip local reference metadata when a bare Messenger echo arrives.
  const fallback = newPayload.tenh_reply_fallback || oldPayload.tenh_reply_fallback;
  if (fallback) {
    // A confirmed send without a quote must not regain the stale optimistic
    // reference when realtime, retry responses or cached history merge.
    payload.tenh_reply_fallback = fallback;
    delete payload.tenh_reply;
    delete payload.reply_to_message;
  } else if (!payload.tenh_reply && oldPayload.tenh_reply) payload.tenh_reply = oldPayload.tenh_reply;
  for (const [field, timeKey] of [["tenh_message_pin", "updated_at"], ["tenh_edit", "edited_at"]]) {
    if (oldPayload[field] && (!newPayload[field] || metadataTime(oldPayload[field], timeKey) > metadataTime(newPayload[field], timeKey))) {
      payload[field] = oldPayload[field];
      if (field === "tenh_edit") result.message_text = other.message_text;
    }
  }
  const deletion = newPayload.tenh_deleted || oldPayload.tenh_deleted;
  if (deletion) {
    payload.tenh_deleted = deletion;
    const deletedCopy = newPayload.tenh_deleted ? preferred : other;
    result.message_text = deletedCopy.message_text;
    result.attachment_url = null;
  }
  if (Object.keys(payload).length) result.raw_payload = payload;

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
