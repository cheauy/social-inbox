import { NextRequest, NextResponse } from "next/server";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptFacebookToken } from "@/lib/facebook/facebook-token-crypto";
import { getCachedConversationThread } from "@/lib/facebook/cached-conversation-link";
import { normalizeBusinessSuiteConversationLink } from "@/lib/facebook/conversation-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ conversationId: string }> };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
const fail = (error: string, status: number, reason?: string) => json({ success: false, error, reason }, status);
const table = "facebook_inbox_links";

async function load(request: NextRequest, context: Context) {
  const { conversationId } = await context.params;
  if (!conversationId || conversationId.length > 100) return { response: fail("Conversation ID is required.", 400) };
  const access = await getInboxConversationAccess(conversationId);
  if (!access.success) return { response: fail(access.error, access.status) };
  const { businessId, conversation } = access, query = new URL(request.url).searchParams;
  if (query.get("businessId") !== businessId) return { response: fail("The selected workspace changed. Reopen this conversation.", 409) };
  const [{ data: thread, error: threadError }, { data: page, error: pageError }, { data: contact, error: contactError }] = await Promise.all([
    supabaseAdmin.from("conversations").select("id,source_type,contact_id,social_account_id").eq("id", conversationId).eq("business_id", businessId).maybeSingle(),
    supabaseAdmin.from("social_accounts").select("id,platform,platform_account_id,is_active,facebook_token_status,facebook_page_access_token_encrypted,updated_at")
      .eq("id", conversation.social_account_id).eq("business_id", businessId).maybeSingle(),
    supabaseAdmin.from("contacts").select("id,platform,platform_user_id").eq("id", conversation.contact_id).eq("business_id", businessId).maybeSingle(),
  ]);
  if (threadError || pageError || contactError) return { response: fail("Unable to verify this conversation. Please try again.", 503) };
  if (!thread || !page || !contact || thread.contact_id !== contact.id || thread.social_account_id !== page.id ||
      thread.source_type !== "messenger" || page.platform !== "facebook" || contact.platform !== "facebook") {
    return { response: fail("A Facebook Messenger conversation is required.", 400) };
  }
  const pageId = page.platform_account_id, recipientId = contact.platform_user_id;
  if (![pageId, recipientId].every(id => typeof id === "string" && /^\d{1,32}$/.test(id)) || pageId === recipientId ||
      query.get("pageId") !== pageId || query.get("recipientId") !== recipientId) {
    return { response: fail("The selected Page or customer changed. Reopen this conversation.", 409) };
  }
  if (!page.is_active || /disconnected|expired|invalid|revoked/i.test(page.facebook_token_status || "")) {
    return { response: fail("Facebook access is unavailable. Ask an Owner to reconnect this Page in Integrations.", 424) };
  }
  // A read-only Graph thread lookup does not depend on the manual-link table.
  const threadOnly = request.method === "GET" && query.get("lookup") === "thread";
  const { data: saved, error } = threadOnly ? { data: null, error: null } : await supabaseAdmin.from(table)
    .select("contact_id,page_id,selected_item_id,conversation_link,confirmed_at")
    .eq("business_id", businessId).eq("social_account_id", page.id).eq("recipient_id", recipientId).maybeSingle();
  if (error) return { response: fail("Conversation link storage is unavailable. Ask an Owner to apply the latest database update.", 503) };
  const savedLink = saved && saved.contact_id === contact.id && saved.page_id === pageId
    ? normalizeBusinessSuiteConversationLink(saved.conversation_link, pageId, recipientId) : null;
  const validSavedLink = savedLink && new URL(savedLink).searchParams.get("selected_item_id") === saved?.selected_item_id ? savedLink : null;
  return { access, page, contact, pageId, recipientId, businessId, conversationId, saved, savedLink: validSavedLink, query };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const loaded = await load(request, context);
    if (loaded.response) return loaded.response;
    const { access, page, pageId, recipientId, businessId, conversationId, saved, savedLink, query } = loaded;
    const identity = { conversationId, businessId, pageId, recipientId };
    const threadOnly = query.get("lookup") === "thread";
    if (!threadOnly && query.get("settings") === "1") return json({ success: true, ...identity,
      conversationLink: savedLink, confirmedAt: saved?.confirmed_at ?? null, canSaveLink: await memberHasPermission(access!.member, "customers", "manage") });
    if (!threadOnly && savedLink) return json({ success: true, ...identity, conversationLink: savedLink,
      linkSource: "agent_saved_business_suite", confirmedAt: saved?.confirmed_at, cacheUsed: true });
    if (!page.facebook_page_access_token_encrypted) return fail("This Page needs to be reconnected in Integrations.", 424);
    let token: string;
    try { token = decryptFacebookToken(page.facebook_page_access_token_encrypted); }
    catch { return fail("This Page needs to be reconnected in Integrations.", 424); }
    if (!token.trim()) return fail("This Page needs to be reconnected in Integrations.", 424);
    const { thread, cacheUsed } = await getCachedConversationThread({ businessId: businessId!, conversationId: conversationId!, socialAccountId: page.id,
      pageId, recipientId, connectionVersion: page.updated_at ?? null }, token, query.get("refresh") === "1");
    if ("reason" in thread) {
      const error = thread.reason === "profile_conversation_access_unavailable"
        ? "Meta denied conversation access. Ask an Owner to check this Page in Integrations."
        : thread.reason === "profile_conversation_not_found"
          ? "Meta did not return a Messenger conversation for this customer."
          : thread.reason === "profile_conversation_ambiguous" || thread.reason === "profile_conversation_participants_unmatched"
            ? "Meta's conversation result could not be matched to this Page and customer."
            : "Unable to fetch this customer's Meta conversation. Please try again.";
      return json({ success: false, ...identity, threadLookupSucceeded: false, reason: thread.reason, cacheUsed, error }, 424);
    }
    const directLink = normalizeBusinessSuiteConversationLink(thread.providerLink, pageId, recipientId);
    const details = { threadLookupSucceeded: true, thread_id: thread.threadId, threadIdSource: thread.threadSource,
      metaConversationLink: thread.providerLink, cacheUsed };
    // Meta's conversation ID is returned exactly. It is not a Suite routing ID.
    if (threadOnly) return json({ success: true, ...identity, ...details, navigationAvailable: Boolean(directLink),
      conversationLink: directLink, navigationReason: directLink ? null : "facebook_direct_link_required" });
    if (directLink) return json({ success: true, ...identity, ...details, conversationLink: directLink, linkSource: "meta_conversations_api" });
    // Reported legacy Page inbox links redirect to the first Suite conversation.
    // Do not silently reopen that route or fabricate a selected_item_id.
    return json({ success: false, ...identity, ...details, reason: "facebook_direct_link_required", navigationAvailable: false,
      error: "Meta found the conversation, but direct opening in Business Suite is unavailable for this chat." }, 424);
  } catch { return fail("Unable to open this conversation. Please try again.", 503); }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return fail("Invalid request origin.", 403);
    let body: Record<string, unknown>;
    try { const value = await request.json(); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); body = value; }
    catch { return fail("Invalid request.", 400); }
    const loaded = await load(request, context);
    if (loaded.response) return loaded.response;
    const { access, page, contact, pageId, recipientId, businessId, saved } = loaded;
    if (!(await memberHasPermission(access!.member, "customers", "manage"))) return fail("You do not have permission to edit customer links.", 403);
    if (body.expectedConfirmedAt !== (saved?.confirmed_at ?? null)) return fail("This link changed. Reopen the form and try again.", 409);
    const removing = body.conversationLink === null;
    const url = normalizeBusinessSuiteConversationLink(body.conversationLink, pageId, recipientId);
    if (!removing && (!url || body.confirmed !== true)) return fail("Paste the Business Suite URL for this Page and confirm you selected this customer.", 400);
    let error, data;
    if (removing) {
      if (!saved) return json({ success: true, conversationLink: null, confirmedAt: null });
      // Mutation filters are repeated to keep deletion bound to this customer.
      ({ error, data } = await supabaseAdmin.from(table).delete().eq("business_id", businessId).eq("social_account_id", page.id)
        .eq("recipient_id", recipientId).eq("confirmed_at", saved.confirmed_at).select("conversation_link,confirmed_at").maybeSingle());
    } else {
      const row = { business_id: businessId, social_account_id: page.id, contact_id: contact.id, page_id: pageId, recipient_id: recipientId,
        selected_item_id: new URL(url!).searchParams.get("selected_item_id"), conversation_link: url,
        confirmed_by_member_id: access!.member.id, confirmed_at: new Date().toISOString() };
      if (saved) ({ error, data } = await supabaseAdmin.from(table).update(row).eq("business_id", businessId).eq("social_account_id", page.id)
        .eq("recipient_id", recipientId).eq("confirmed_at", saved.confirmed_at).select("conversation_link,confirmed_at").maybeSingle());
      else ({ error, data } = await supabaseAdmin.from(table).insert(row).select("conversation_link,confirmed_at").maybeSingle());
    }
    if (error?.code === "23505") return fail("This link is already saved or assigned to another customer. Reopen the form and check the selected chat.", 409);
    if (error) return fail("Unable to save the conversation link. Please try again.", 503);
    if (!data) return fail("This link changed. Reopen the form and try again.", 409);
    return json({ success: true, conversationLink: removing ? null : data.conversation_link, confirmedAt: removing ? null : data.confirmed_at });
  } catch { return fail("Unable to save the conversation link. Please try again.", 503); }
}
