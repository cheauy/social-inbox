import type { InboxMessage } from "@/types/inbox";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export function telegramAlbumPosition(message: InboxMessage): number | null {
  const position = record(record(message.raw_payload).tenh_media_group).position;
  return Number.isInteger(position) && Number(position) >= 0 ? Number(position) : null;
}

export function telegramClientRequestId(message: InboxMessage): string | null {
  const value = record(message.raw_payload).tenh_client_request_id;
  return typeof value === "string" && /^optimistic:attachment:[\w.-]{1,100}$/.test(value)
    ? value
    : null;
}

/** Match album results by the exact per-file request id, never by name/content/time. */
export function correlateTelegramAlbumMessages(
  tempIds: readonly string[],
  messages: readonly InboxMessage[],
): Array<InboxMessage | undefined> {
  const byRequestId = new Map<string, InboxMessage>();
  for (const message of messages) {
    const requestId = telegramClientRequestId(message);
    if (requestId && !byRequestId.has(requestId)) byRequestId.set(requestId, message);
  }
  return tempIds.map(tempId => byRequestId.get(tempId));
}
