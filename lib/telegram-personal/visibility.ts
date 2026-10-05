import "server-only";

import { requestMemo } from "@/lib/server/request-scope";
import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * Telegram Personal chats are ordinary inbox rows, but only the account holder
 * and the teammates allowed by the account's team-access setting may see them.
 * Server code reads with the admin client (row level security is bypassed), so
 * EVERY read of conversations, messages, contacts and their related rows must
 * either go through getInboxConversationAccess / getInboxContactAccess (which
 * call this module) or apply the filter values below.
 * tests/telegram-personal-visibility-guard.test.cjs fails when a server file
 * reads those tables without doing so.
 *
 * Identity keys carry the Personal account id, so filters need no joins:
 *   conversations.social_account_id      = <account id>
 *   messages.platform_message_id          = tgp:<account id>:<chat id>:<message id>
 *   contacts.platform_user_id (platform telegram_personal) = <account id>:<telegram user id>
 */

export const PERSONAL_PLATFORM = "telegram_personal";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function canSee(accountId: string, userId: string) {
  const { data, error } = await supabaseAdmin.rpc("tgp_member_can_see", { p_social_account: accountId, p_user: userId });
  if (error) {
    // Visibility unknown (e.g. migration missing): fail closed, never open.
    console.error("[TENH Telegram Personal] visibility check failed:", error.code ?? "unknown");
    return false;
  }
  return data === true;
}

/** Personal account ids in these workspaces whose chats this user may NOT see (memoized per request). */
export function hiddenPersonalAccountIds(businessIds: readonly string[], userId: string): Promise<string[]> {
  const ids = [...new Set(businessIds.filter((id) => UUID.test(id)))].sort();
  if (!ids.length) return Promise.resolve([]);
  // Without a user id nothing is visible: every Personal account is hidden.
  return requestMemo(`tgp-hidden:${userId || "-"}:${ids.join(",")}`, async () => {
    const { data, error } = await supabaseAdmin
      .from("social_accounts")
      .select("id")
      .in("business_id", ids)
      .eq("platform", PERSONAL_PLATFORM);
    if (error) throw new Error("Unable to verify Telegram Personal visibility.");
    const hidden: string[] = [];
    for (const row of (data ?? []) as Array<{ id: string }>) {
      if (!userId || !(await canSee(row.id, userId))) hidden.push(row.id);
    }
    return hidden;
  });
}

export async function canSeePersonalAccount(accountId: string | null | undefined, userId: string) {
  if (!accountId || !UUID.test(accountId) || !userId) return false;
  return requestMemo(`tgp-see:${userId}:${accountId}`, () => canSee(accountId, userId));
}

/**
 * Filter values for the admin query builder (applied at the call site, e.g.
 *   if (list) query = query.filter("social_account_id", "not.in", list);
 *   for (const p of hiddenMessagePatterns(hidden)) query = query.filter("platform_message_id", "not.like", p);
 */
export function hiddenAccountInList(hidden: readonly string[]) {
  return hidden.length ? `(${hidden.join(",")})` : null;
}

export function hiddenMessagePatterns(hidden: readonly string[]) {
  return hidden.map((id) => `tgp:${id}:%`);
}

export function hiddenContactPatterns(hidden: readonly string[]) {
  return hidden.map((id) => `${id}:%`);
}

/** Account id carried by a Personal message key or contact id; null for other platforms. */
export function personalAccountFromMessageKey(key: string | null | undefined) {
  const match = /^tgp:([0-9a-f-]{36}):/i.exec(key ?? "");
  return match ? match[1] : null;
}

export function personalAccountFromContact(row: { platform?: string | null; platform_user_id?: string | null }) {
  if (row.platform !== PERSONAL_PLATFORM) return null;
  const match = /^([0-9a-f-]{36}):/i.exec(row.platform_user_id ?? "");
  return match ? match[1] : null;
}

/** In-memory filters for rows that were already loaded (e.g. joined selects). */
export function isHiddenConversation(row: { social_account_id?: string | null }, hidden: readonly string[]) {
  return Boolean(row.social_account_id && hidden.includes(row.social_account_id));
}

export function isHiddenMessage(row: { platform_message_id?: string | null }, hidden: readonly string[]) {
  const account = personalAccountFromMessageKey(row.platform_message_id);
  return Boolean(account && hidden.includes(account));
}

export function isHiddenContact(row: { platform?: string | null; platform_user_id?: string | null }, hidden: readonly string[]) {
  const account = personalAccountFromContact(row);
  return Boolean(account && hidden.includes(account));
}

const unique = (ids: readonly (string | null | undefined)[]) =>
  [...new Set(ids.filter((id): id is string => typeof id === "string" && UUID.test(id)))];

/** Which of these conversation ids belong to hidden Personal accounts. */
export async function hiddenConversationIdSet(conversationIds: readonly (string | null | undefined)[], hidden: readonly string[]) {
  const ids = unique(conversationIds);
  const result = new Set<string>();
  if (!ids.length || !hidden.length) return result;
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .in("id", ids.slice(offset, offset + 200))
      .in("social_account_id", [...hidden]);
    if (error) throw new Error("Unable to verify Telegram Personal visibility.");
    for (const row of (data ?? []) as Array<{ id: string }>) result.add(row.id);
  }
  return result;
}

/** Which of these contact ids are customers of hidden Personal accounts. */
export async function hiddenContactIdSet(contactIds: readonly (string | null | undefined)[], hidden: readonly string[]) {
  const ids = unique(contactIds);
  const result = new Set<string>();
  if (!ids.length || !hidden.length) return result;
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("id,platform,platform_user_id")
      .in("id", ids.slice(offset, offset + 200))
      .eq("platform", PERSONAL_PLATFORM);
    if (error) throw new Error("Unable to verify Telegram Personal visibility.");
    for (const row of (data ?? []) as Array<{ id: string; platform: string; platform_user_id: string }>) {
      if (isHiddenContact(row, hidden)) result.add(row.id);
    }
  }
  return result;
}

/**
 * All conversation ids of hidden Personal accounts, for paged reads of rows that
 * only carry a conversation id. Shared chats are chosen one by one by the
 * holder, so the list stays small; a very large list fails closed.
 */
export async function hiddenPersonalConversationIds(hidden: readonly string[]) {
  if (!hidden.length) return [] as string[];
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .in("social_account_id", [...hidden])
    .limit(1001);
  if (error || (data ?? []).length > 1000) throw new Error("Unable to verify Telegram Personal visibility.");
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

/** PostgREST or-filter keeping rows whose id in this column is not hidden (rows without one stay). */
export function visibleIdOrFilter(column: string, hiddenConversationIds: readonly string[]) {
  return hiddenConversationIds.length
    ? `${column}.is.null,${column}.not.in.(${hiddenConversationIds.join(",")})`
    : null;
}

/** All contact ids that are customers of hidden Personal accounts (same size rule). */
export async function hiddenPersonalContactIds(hidden: readonly string[]) {
  if (!hidden.length) return [] as string[];
  let query = supabaseAdmin.from("contacts").select("id").eq("platform", PERSONAL_PLATFORM);
  query = query.or(hiddenContactPatterns(hidden).map((p) => `platform_user_id.like.${p}`).join(","));
  const { data, error } = await query.limit(1001);
  if (error || (data ?? []).length > 1000) throw new Error("Unable to verify Telegram Personal visibility.");
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

/** True when this conversation is a Telegram Personal chat the user may not see (fails closed). */
export async function isConversationHiddenFor(conversationId: string | null | undefined, userId: string) {
  if (!conversationId) return false;
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .select("social_account_id,platform")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error("Unable to verify Telegram Personal visibility.");
  const row = data as { social_account_id: string | null; platform: string | null } | null;
  if (!row || row.platform !== PERSONAL_PLATFORM) return false;
  return !(await canSeePersonalAccount(row.social_account_id, userId));
}
