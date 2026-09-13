import { NextRequest, NextResponse } from "next/server";
import { memberHasPermission } from "@/lib/auth/require-permission";
import { getInboxConversationAccess } from "@/lib/inbox/get-inbox-resource-access";
import { mutateMessageMetadata, MessageMutationError } from "@/lib/inbox/mutate-message-metadata";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { facebookSendBlockReason } from "@/lib/facebook/customer-block";
import { getFacebookPageAccessToken, isFacebookAccessTokenError, refreshFacebookPageAccessToken } from "@/lib/facebook/get-facebook-page-access-token";
import { canReactToMessengerMessage, isMessengerReactionEmoji, messengerReactionPayload, withMessengerReaction } from "@/lib/facebook/message-reactions";
import type { InboxMessage } from "@/types/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status: number, code = "MESSENGER_REACTION_FAILED") => json({ success: false, error, code }, status);

type GraphResult = { recipient_id?: string; error?: { code?: number; error_subcode?: number; message?: string; type?: string } };

export async function POST(request: NextRequest) {
  let dispatched = false;
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) return fail("A same-origin signed-in request is required.", 403);
    let body: { conversationId?: unknown; messageId?: unknown; reaction?: unknown };
    try {
      const raw = await request.text();
      if (raw.length > 4096) return fail("Request too large.", 413);
      body = JSON.parse(raw);
    } catch { return fail("Invalid reaction request.", 400); }
    if (!body || typeof body.conversationId !== "string" || body.conversationId.length > 100 ||
        typeof body.messageId !== "string" || !body.messageId || body.messageId.length > 100 ||
        (body.reaction !== null && !isMessengerReactionEmoji(body.reaction))) {
      return fail("A conversation, message and one emoji (or null to remove it) are required.", 400);
    }
    const emoji = body.reaction as string | null;
    const access = await getInboxConversationAccess(body.conversationId);
    if (!access.success) return fail(access.error, access.status);
    if (!(await memberHasPermission(access.member, "conversations", "manage"))) return fail("You do not have permission to react in this conversation.", 403);
    const [messageResult, pageResult, contactResult] = await Promise.all([
      supabaseAdmin.from("messages").select("*").eq("id", body.messageId).eq("conversation_id", access.conversation.id).eq("business_id", access.businessId).maybeSingle(),
      supabaseAdmin.from("social_accounts").select("id,platform,platform_account_id,is_active").eq("id", access.conversation.social_account_id).eq("business_id", access.businessId).maybeSingle(),
      supabaseAdmin.from("contacts").select("id,platform,platform_user_id").eq("id", access.conversation.contact_id).eq("business_id", access.businessId).maybeSingle(),
    ]);
    if (messageResult.error || pageResult.error || contactResult.error) return fail("Unable to verify this Messenger message.", 503);
    if (!messageResult.data) return fail("Message was not found in this conversation.", 404);
    const message = messageResult.data as InboxMessage, page = pageResult.data, contact = contactResult.data;
    if (!page?.is_active || page.platform !== "facebook" || contact?.platform !== "facebook" ||
        !/^\d{1,30}$/.test(page.platform_account_id) || !/^\d{1,30}$/.test(contact.platform_user_id) ||
        !canReactToMessengerMessage(message, page.platform)) return fail("Reactions are available on existing Messenger messages, including photos and other media.", 409);
    const pageId = page.platform_account_id, psid = contact.platform_user_id;
    const participants = new Set([pageId, psid]);
    if ((message.sender_platform_id && !participants.has(message.sender_platform_id)) ||
        (message.recipient_platform_id && !participants.has(message.recipient_platform_id))) return fail("This message does not belong to the selected Page and customer.", 409);
    const blocked = await facebookSendBlockReason({ businessId: access.businessId, socialAccountId: page.id, contactId: contact.id });
    if (blocked) return fail(blocked, 403);

    let token = await getFacebookPageAccessToken(pageId);
    const version = process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";
    const url = `https://graph.facebook.com/${version}/${pageId}/messages`;
    const payload = messengerReactionPayload(psid, message.platform_message_id, emoji);
    const timestamp = Date.now();
    const attempt = async () => {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(12000) });
      let result: GraphResult = {};
      try { result = await response.json(); } catch { /* confirmation checked below */ }
      return { response, result };
    };
    dispatched = true;
    let sent = await attempt();
    // Retry only an explicit token rejection, never an ambiguous network result.
    if ((!sent.response.ok || sent.result.error) && isFacebookAccessTokenError(sent.result.error)) {
      token = await refreshFacebookPageAccessToken(pageId);
      sent = await attempt();
    }
    if (!sent.response.ok || sent.result.error) {
      const code = sent.result.error?.code;
      const reference = code ? ` (Meta ${code}${sent.result.error?.error_subcode ? `/${sent.result.error.error_subcode}` : ""})` : "";
      return fail(`Messenger could not ${emoji === null ? "remove" : "save"} this reaction. Check the Page connection and whether Meta allows an action on this message.${reference}`, 502, "MESSENGER_REACTION_REJECTED");
    }
    if (sent.result.recipient_id !== psid) return fail("Meta did not confirm this reaction. Check Messenger before trying again.", 502, "MESSENGER_REACTION_UNCONFIRMED");

    try {
      const updated = await mutateMessageMetadata(supabaseAdmin, { businessId: access.businessId, conversationId: access.conversation.id, messageId: message.id }, current => ({
        raw_payload: withMessengerReaction(current.raw_payload, "page", { emoji, timestamp, member_id: access.member.id }),
      }));
      return json({ success: true, reaction: emoji, timestamp, message: updated });
    } catch {
      // The provider action succeeded. Do not present a DB failure as a send failure.
      return json({ success: true, reaction: emoji, timestamp, warning: "Reaction saved in Messenger, but TENH could not save its display. Refresh the conversation later." });
    }
  } catch (error) {
    if (error instanceof MessageMutationError) return fail(error.message, error.status);
    return fail(dispatched ? "The reaction result is uncertain. Check Messenger before trying again." : "Unable to prepare the reaction. Please check the Page connection.", 502);
  }
}
