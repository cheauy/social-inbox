import type { InboxMessage } from "@/types/inbox";
import { retainLocalImagePreview } from "./local-image-preview";
import { matchesOptimisticMessage } from "./optimistic-message-match";
import { withOptimisticRenderKey } from "./confirm-outgoing-message";

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
  // A bare echo/history projection must not erase authoritative album metadata.
  for (const field of ["tenh_media_group", "tenh_image_album", "media_group_id"]) {
    if (payload[field] == null && oldPayload[field] != null) payload[field] = oldPayload[field];
  }
  const oldNative = asRecord(oldPayload.message), newNative = asRecord(payload.message);
  if (newNative.attachments == null && Array.isArray(oldNative.attachments)) {
    payload.message = { ...newNative, attachments: oldNative.attachments };
  }
  if (asRecord(payload.message).media_group_id == null && oldNative.media_group_id != null) {
    payload.message = { ...asRecord(payload.message), media_group_id: oldNative.media_group_id };
  }
  // History responses may omit an incoming message's ad referral. Retain the
  // original event context so an older source card survives a refresh.
  if (!asRecord(payload.message).referral && asRecord(oldPayload.message).referral) {
    payload.message = { ...asRecord(payload.message), referral: asRecord(oldPayload.message).referral };
    for (const field of ["timestamp", "sender", "recipient"]) {
      if (payload[field] == null && oldPayload[field] != null) payload[field] = oldPayload[field];
    }
  }
  // Never strip local reference metadata when a bare Messenger echo arrives.
  const fallback = newPayload.tenh_reply_fallback || oldPayload.tenh_reply_fallback;
  if (fallback) {
    // A confirmed send without a quote must not regain the stale optimistic
    // reference when realtime, retry responses or cached history merge.
    payload.tenh_reply_fallback = fallback;
    delete payload.tenh_reply;
    delete payload.reply_to_message;
  } else if (!payload.tenh_reply && oldPayload.tenh_reply) payload.tenh_reply = oldPayload.tenh_reply;
  if (!fallback) {
    // A send response / bare echo may omit the native quote. Preserve the
    // previously confirmed MID and snapshot alongside the local jump target.
    for (const field of ["reply_to", "tenh_facebook_reply"]) {
      if (!payload[field] && oldPayload[field]) payload[field] = oldPayload[field];
    }
    if (!asRecord(payload.message).reply_to && asRecord(oldPayload.message).reply_to) {
      payload.message = { ...asRecord(payload.message), reply_to: asRecord(oldPayload.message).reply_to };
    }
  }
  for (const [field, timeKey] of [["tenh_message_pin", "updated_at"], ["tenh_edit", "edited_at"]]) {
    if (oldPayload[field] && (!newPayload[field] || metadataTime(oldPayload[field], timeKey) > metadataTime(newPayload[field], timeKey))) {
      payload[field] = oldPayload[field];
      if (field === "tenh_edit") result.message_text = other.message_text;
    }
  }
  // Preserve each participant's latest reaction, including a removal, when an
  // older history response or bare echo arrives after the Realtime update.
  for (const actor of ["page", "customer"] as const) {
    const oldReaction = asRecord(asRecord(oldPayload.tenh_messenger_reactions)[actor]);
    const newReaction = asRecord(asRecord(newPayload.tenh_messenger_reactions)[actor]);
    const oldTime = Number(oldReaction.timestamp) || 0;
    const newTime = Number(newReaction.timestamp) || 0;
    if (oldTime > newTime) {
      payload.tenh_messenger_reactions = { ...asRecord(payload.tenh_messenger_reactions), [actor]: oldReaction };
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
  let merged: InboxMessage = result;
  if (!result.id.startsWith("optimistic:")) {
    delete result.__optimistic_status;
    delete result.__optimistic_created_at;
    delete (result as { __optimistic_requires_review?: boolean }).__optimistic_requires_review;
    // Keep the pending bubble's React identity and position once confirmed,
    // and keep an earlier confirmation's identity across later refreshes.
    const temporary = [first, second].find((row) => row.id.startsWith("optimistic:"));
    const keyed = other as InboxMessage & { __render_key?: string };
    if (temporary) merged = withOptimisticRenderKey(result, temporary);
    else if (keyed.__render_key && !(preferred as { __render_key?: string }).__render_key) {
      merged = { ...result, __render_key: keyed.__render_key, platform_created_at: keyed.platform_created_at } as InboxMessage;
    }
  }
  return retainLocalImagePreview(merged, other);
}

const isTemporary = (message: InboxMessage) => message.id.startsWith("optimistic:");
const businessOf = (message: InboxMessage) => (message as { business_id?: string | null }).business_id ?? null;
const sameWorkspace = (a: InboxMessage, b: InboxMessage) => !businessOf(a) || !businessOf(b) || businessOf(a) === businessOf(b);

/*
 * Fold each pending bubble into the stored row it is exactly correlated with:
 * the client request id / Messenger metadata, or the confirmed MID. Never by
 * text or time, so two identical sends stay two messages. Scoped to the same
 * conversation and workspace. Runs on every update path because the stored
 * row can gain its correlation after it already exists (a later UPDATE).
 */
function reconcileOptimistic(rows: InboxMessage[]): InboxMessage[] {
  if (!rows.some(isTemporary)) return rows;
  const consumed = new Set<number>();
  const replaced = new Map<number, InboxMessage>();
  rows.forEach((row, index) => {
    if (!isTemporary(row)) return;
    const match = rows.findIndex((candidate, at) => at !== index && !consumed.has(at) && !isTemporary(candidate) &&
      sameWorkspace(row, candidate) &&
      matchesOptimisticMessage(row, candidate as unknown as Record<string, unknown>));
    if (match < 0) return;
    consumed.add(match);
    replaced.set(index, merge(row, rows[match]));
  });
  return consumed.size ? rows.flatMap((row, at) => consumed.has(at) ? [] : [replaced.get(at) ?? row]) : rows;
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
  return reconcileOptimistic(rows);
}
