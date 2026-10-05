import { randomUUID } from "expo-crypto";
import { api, authSessionGeneration } from "./api/client";
import type { InboxMessage } from "./types";
import { getTelegramReaction, isTelegramReactionEmoji, telegramReactionTarget, type TelegramReactionState } from "../../lib/telegram/message-reactions";

type Scope = { businessId: string; accountId: string; conversationId: string; messageId: string; platformMessageId: string; chatId: string; groupKey: string };
export type TelegramReactionCapability = { owner: string; authGeneration: number; scope: Scope; available: boolean; emojis: string[]; state: TelegramReactionState | null; album: boolean; reason: string | null };
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
function scopeMatches(scope: unknown, expected: Scope) {
  const actual = record(scope);
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}
function messageScope(message: InboxMessage, businessId: string, accountId: string): Scope | null {
  const target = telegramReactionTarget(message);
  return target && businessId && accountId ? { businessId, accountId, conversationId: message.conversation_id,
    messageId: message.id, platformMessageId: message.platform_message_id, chatId: target.chatId, groupKey: target.groupKey } : null;
}

export async function loadTelegramReactionCapability(message: InboxMessage, owner: string, businessId: string, accountId: string, userId: string): Promise<TelegramReactionCapability | null> {
  const authGeneration = authSessionGeneration();
  const scope = messageScope(message, businessId, accountId);
  if (!owner || !scope || !userId) return null;
  const result = record(await api(`/api/telegram/messages/reaction?${new URLSearchParams(scope)}`, businessId, { expectedUserId: userId }));
  if (authSessionGeneration() !== authGeneration || result.version !== 1 || !scopeMatches(result.scope, scope)) return null;
  const state = result.state === null ? null : getTelegramReaction({ tenh_telegram_reaction: result.state });
  if (result.state !== null && !state || state && (state.chatId !== scope.chatId || state.groupKey !== scope.groupKey)) return null;
  if (!Array.isArray(result.emojis) || !result.emojis.every(isTelegramReactionEmoji)) return null;
  return { owner, authGeneration, scope, available: result.available === true && state?.status !== "pending" && state?.status !== "uncertain",
    emojis: [...new Set(result.emojis)], state, album: scope.groupKey.startsWith("a:"), reason: typeof result.reason === "string" ? result.reason : null };
}

export function canUseTelegramReaction(capability: TelegramReactionCapability | null | undefined, message: InboxMessage, owner: string) {
  if (!capability || !owner || capability.owner !== owner || capability.authGeneration !== authSessionGeneration() || !capability.available) return false;
  const scope = messageScope(message, capability.scope.businessId, capability.scope.accountId);
  return !!scope && scopeMatches(capability.scope, scope);
}

export async function sendTelegramReaction(capability: TelegramReactionCapability, message: InboxMessage, owner: string, emoji: string | null, userId: string) {
  if (!canUseTelegramReaction(capability, message, owner) || !userId || emoji !== null && !capability.emojis.includes(emoji)) throw new Error("The reaction target changed. Reopen the actions.");
  const result = record(await api("/api/telegram/messages/reaction", capability.scope.businessId, { method: "POST", expectedUserId: userId,
    body: { ...capability.scope, requestId: randomUUID(), expectedRevision: capability.state?.revision ?? 0, reaction: emoji } }));
  const state = getTelegramReaction({ tenh_telegram_reaction: result.state });
  if (capability.authGeneration !== authSessionGeneration() || result.version !== 1 || !scopeMatches(result.scope, capability.scope) || !state || state.chatId !== capability.scope.chatId || state.groupKey !== capability.scope.groupKey) {
    throw new Error("The bot reaction result is unconfirmed. Refresh before choosing another action.");
  }
  return { scope: capability.scope, state };
}

export function applyTelegramReactionState(messages: InboxMessage[], scope: Pick<Scope, "conversationId" | "chatId" | "groupKey">, state: TelegramReactionState) {
  if (state.chatId !== scope.chatId || state.groupKey !== scope.groupKey) return messages;
  return messages.map(message => {
    const target = telegramReactionTarget(message), previous = getTelegramReaction(message.raw_payload);
    if (message.conversation_id !== scope.conversationId || !target || target.chatId !== scope.chatId || target.groupKey !== scope.groupKey ||
        previous && (previous.revision > state.revision || previous.revision === state.revision && Date.parse(previous.updatedAt) > Date.parse(state.updatedAt))) return message;
    return { ...message, raw_payload: { ...message.raw_payload, tenh_telegram_reaction: state } };
  });
}
