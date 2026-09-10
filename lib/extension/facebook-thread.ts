import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/*
 * Turning "what the browser is looking at" into "which TENH record that is".
 *
 * A Facebook tab knows two things TENH can match on: the Page id in the URL,
 * and the thread id Business Suite puts in `selected_item_id`. Both are ids.
 * Neither is a name, and that is the point -- two shops share a Page name and
 * two customers share "Dara", so matching on either would eventually attach
 * one person's notes to somebody else's conversation.
 *
 * Every lookup here is scoped to the device's own workspace and returns null
 * rather than a best guess. An unmatched thread is a thread the panel says
 * nothing about, which is the honest answer and the safe one.
 */

export type ResolvedPage = {
  socialAccountId: string;
  pageId: string;
  pageName: string | null;
};

export type ResolvedThread = {
  page: ResolvedPage;
  conversationId: string;
  contactId: string;
  contactName: string | null;
};

function normalizeId(value: unknown) {
  return typeof value === "string" && /^[0-9]{5,32}$/.test(value.trim())
    ? value.trim()
    : null;
}

/** The workspace's connected Page with this id, if it has one. */
export async function resolvePage(
  businessId: string,
  rawPageId: unknown,
): Promise<ResolvedPage | null> {
  const pageId = normalizeId(rawPageId);

  if (!pageId) return null;

  const { data } = await supabaseAdmin
    .from("social_accounts")
    .select("id,platform_account_id,account_name")
    .eq("business_id", businessId)
    .eq("platform", "facebook")
    .eq("platform_account_id", pageId)
    .maybeSingle();

  if (!data) return null;

  return {
    socialAccountId: data.id as string,
    pageId,
    pageName: (data.account_name as string | null) ?? null,
  };
}

/**
 * The Messenger conversation behind a Facebook thread id.
 *
 * Business Suite's thread id for a Page inbox is the customer's page-scoped
 * id, which is exactly what TENH stores on the contact. When it is something
 * else -- a comment thread, a surface this build has not seen -- there is no
 * match, and the caller is told so instead of being handed the nearest row.
 */
export async function resolveThread(
  businessId: string,
  rawPageId: unknown,
  rawThreadId: unknown,
): Promise<ResolvedThread | null> {
  const page = await resolvePage(businessId, rawPageId);
  const threadId = normalizeId(rawThreadId);

  if (!page || !threadId) return null;

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id,full_name")
    .eq("business_id", businessId)
    .eq("platform", "facebook")
    .eq("platform_user_id", threadId)
    .maybeSingle();

  if (!contact) return null;

  /*
   * Scoped to the Page as well as the customer. One person can write to two of
   * a workspace's Pages, and those are two conversations that must never be
   * shown as one.
   */
  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("business_id", businessId)
    .eq("contact_id", contact.id as string)
    .eq("social_account_id", page.socialAccountId)
    .eq("source_type", "messenger")
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!conversation) return null;

  return {
    page,
    conversationId: conversation.id as string,
    contactId: contact.id as string,
    contactName: (contact.full_name as string | null) ?? null,
  };
}

/**
 * Normalized message text, for comparing what a browser saw with what Meta
 * delivered.
 *
 * Facebook's DOM gives text with its own spacing and invisible characters;
 * the webhook gives the string the sender typed. Comparing them literally
 * would report a duplicate as missing every time somebody's message contained
 * two spaces.
 */
export function normalizeMessageText(value: unknown) {
  return typeof value === "string"
    ? value
        .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
    : "";
}
