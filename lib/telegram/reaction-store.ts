import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboxMessage } from "../../types/inbox";
import { getTelegramReaction, telegramReactionTarget, type TelegramReactionState } from "./message-reactions";

export type TelegramReactionScope = {
  businessId: string; accountId: string; conversationId: string; messageId: string;
  chatId: string; groupKey: string; targetMessageId: string;
  botId: string;
  expectedRevision?: number;
};
export class TelegramReactionStoreError extends Error {}
export const telegramReactionsEnabled = () => process.env.TENH_TELEGRAM_REACTIONS_ENABLED === "true";

export async function reactionStoreReady(db: SupabaseClient, businessId: string) {
  const result = await db.rpc("tenh_telegram_reaction_ready", { p_business: businessId });
  if (result.error || result.data?.version !== 1) throw new TelegramReactionStoreError("Telegram reactions need the reviewed backend migration.");
  return result.data.enabled === true;
}

export async function readReactionState(db: SupabaseClient, scope: TelegramReactionScope) {
  const { data, error } = await db.from("telegram_reaction_state").select("*")
    .eq("business_id", scope.businessId).eq("social_account_id", scope.accountId).eq("conversation_id", scope.conversationId)
    .eq("chat_id", scope.chatId).eq("group_key", scope.groupKey).maybeSingle();
  if (error) throw new TelegramReactionStoreError("Unable to verify the durable reaction state.");
  return data ? reactionRowState(data) : null;
}

export function reactionRowState(row: Record<string, unknown>): TelegramReactionState {
  const state = getTelegramReaction({ tenh_telegram_reaction: { status: row.status, emoji: row.confirmed_emoji,
    revision: Number(row.revision), updatedAt: row.updated_at, groupKey: row.group_key, chatId: row.chat_id, targetMessageId: row.target_message_id } });
  if (!state) throw new TelegramReactionStoreError("Invalid durable reaction state.");
  return state;
}

export async function claimReaction(db: SupabaseClient, scope: TelegramReactionScope, requestId: string, memberId: string, emoji: string | null) {
  const { data, error } = await db.rpc("tenh_telegram_reaction_claim", { p_scope: scope, p_request: requestId, p_member: memberId, p_emoji: emoji });
  if (error || !data || !["claimed", "replay", "blocked", "request_conflict", "target_changed", "revision_changed"].includes(data.kind)) {
    throw new TelegramReactionStoreError("Unable to reserve the reaction. No provider action was started.");
  }
  if (["claimed", "replay", "blocked"].includes(data.kind)) {
    const state = getTelegramReaction({ tenh_telegram_reaction: data.state });
    if (!state || state.chatId !== scope.chatId || state.groupKey !== scope.groupKey ||
        data.kind === "claimed" && (state.status !== "pending" || state.targetMessageId !== scope.targetMessageId)) {
      throw new TelegramReactionStoreError("The durable reservation could not be verified. No provider action was started.");
    }
  }
  return data as { kind: "claimed" | "replay" | "blocked" | "request_conflict" | "target_changed" | "revision_changed"; operationStatus?: string; state?: TelegramReactionState };
}

export async function finishReaction(db: SupabaseClient, requestId: string, outcome: "confirmed" | "rejected" | "uncertain") {
  const { data, error } = await db.rpc("tenh_telegram_reaction_finish", { p_request: requestId, p_outcome: outcome });
  const state = getTelegramReaction({ tenh_telegram_reaction: data?.state });
  if (error || !state || data.operationStatus !== outcome) throw new TelegramReactionStoreError("The provider result could not be durably recorded.");
  return state;
}

/** Canonical album state hydrates pages even when the first member is off-page. */
export async function hydrateTelegramReactionStates(db: SupabaseClient, conversationId: string, messages: InboxMessage[]): Promise<InboxMessage[]> {
  if (!telegramReactionsEnabled()) return messages;
  const targets = messages.map(message => telegramReactionTarget(message));
  const groups = [...new Set(targets.flatMap(target => target ? [target.groupKey] : []))];
  if (!groups.length) return messages;
  const conversation = await db.from("conversations").select("business_id,social_account_id")
    .eq("id", conversationId).maybeSingle();
  if (conversation.error || !conversation.data?.social_account_id) return messages;
  const result = await db.from("telegram_reaction_state").select("*")
    .eq("business_id", conversation.data.business_id).eq("social_account_id", conversation.data.social_account_id)
    .eq("conversation_id", conversationId).in("group_key", groups);
  // Missing migration never claims that a reaction is working.
  if (result.error) return messages;
  const states = new Map<string, TelegramReactionState>();
  for (const row of result.data ?? []) {
    try { const state = reactionRowState(row); states.set(JSON.stringify([state.chatId, state.groupKey]), state); } catch { /* fail closed for invalid state */ }
  }
  return messages.map((message, index) => {
    const target = targets[index], state = target && states.get(JSON.stringify([target.chatId, target.groupKey]));
    return state ? { ...message, raw_payload: { ...message.raw_payload, tenh_telegram_reaction: state } } : message;
  });
}
