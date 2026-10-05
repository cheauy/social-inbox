import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * D1 read side for Telegram Personal chats. Personal chats live in their own
 * tables (owner decision), so the existing inbox, customer, search and
 * analytics code never sees them. Every read here goes through
 * tgp_member_can_see, the same rule Realtime row level security uses.
 */

export type PersonalChatRow = {
  id: string;
  business_id: string;
  social_account_id: string;
  title: string;
  username: string | null;
  shared_at: string;
  unshared_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_direction: "incoming" | "outgoing" | null;
  unread_count: number;
  history_import: "none" | "last_50";
};

export type PersonalMessageRow = {
  id: string;
  telegram_message_id: number;
  direction: "incoming" | "outgoing";
  message_type: "text" | "placeholder";
  body: string | null;
  placeholder_kind: string | null;
  sent_at: string;
};

const CHAT_SELECT =
  "id,business_id,social_account_id,title,username,shared_at,unshared_at,last_message_at,last_message_preview,last_direction,unread_count,history_import";

export async function memberCanSeeAccount(socialAccountId: string, userId: string) {
  const { data, error } = await supabaseAdmin.rpc("tgp_member_can_see", {
    p_social_account: socialAccountId,
    p_user: userId,
  });
  if (error) throw new Error("visibility check failed");
  return data === true;
}

/** Personal accounts in this workspace whose chats this user may see, with display names. */
export async function visibleAccounts(businessId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .select("id,account_name")
    .eq("business_id", businessId)
    .eq("platform", "telegram_personal");
  if (error) throw new Error(error.message);
  const accounts = (data ?? []) as Array<{ id: string; account_name: string | null }>;
  const allowed: Array<{ id: string; name: string }> = [];
  for (const account of accounts) {
    if (await memberCanSeeAccount(account.id, userId)) {
      allowed.push({ id: account.id, name: account.account_name ?? "Telegram account" });
    }
  }
  return allowed;
}

export async function listVisibleChats(businessId: string, userId: string) {
  const accounts = await visibleAccounts(businessId, userId);
  if (!accounts.length) return { accounts, chats: [] as PersonalChatRow[] };
  const { data, error } = await supabaseAdmin
    .from("telegram_personal_chats")
    .select(CHAT_SELECT)
    .eq("business_id", businessId)
    .in("social_account_id", accounts.map((account) => account.id))
    .is("unshared_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return { accounts, chats: (data ?? []) as unknown as PersonalChatRow[] };
}

/** One chat, only if it belongs to this workspace and the user may see its account. */
export async function loadVisibleChat(businessId: string, userId: string, chatRowId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(chatRowId)) return null;
  const { data, error } = await supabaseAdmin
    .from("telegram_personal_chats")
    .select(CHAT_SELECT)
    .eq("id", chatRowId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const chat = (data ?? null) as unknown as PersonalChatRow | null;
  if (!chat || !(await memberCanSeeAccount(chat.social_account_id, userId))) return null;
  return chat;
}

/** Newest first. `before` pages by (sent_at, telegram_message_id). */
export async function loadMessages(chatRowId: string, before: { sentAt: string; messageId: number } | null, limit = 50) {
  let query = supabaseAdmin
    .from("telegram_personal_messages")
    .select("id,telegram_message_id,direction,message_type,body,placeholder_kind,sent_at")
    .eq("chat_row_id", chatRowId)
    .order("sent_at", { ascending: false })
    .order("telegram_message_id", { ascending: false })
    .limit(limit + 1);
  if (before) {
    query = query.or(
      `sent_at.lt.${before.sentAt},and(sent_at.eq.${before.sentAt},telegram_message_id.lt.${before.messageId})`,
    );
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as PersonalMessageRow[];
  return { messages: rows.slice(0, limit), hasMore: rows.length > limit };
}
