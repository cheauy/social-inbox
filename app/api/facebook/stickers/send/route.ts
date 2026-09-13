import { FacebookReplyError, getFacebookSendReply } from "@/lib/facebook/send-reply-context";
import { mutateMessageMetadata } from "@/lib/inbox/mutate-message-metadata";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { facebookSendBlockReason } from "@/lib/facebook/customer-block";
import { getFacebookMessengerReplyPolicy } from "@/lib/facebook/messenger-reply-policy";
import {
  getFacebookPageAccessToken,
  isFacebookAccessTokenError,
  refreshFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
import { metaStickerConversation, MetaStickerError } from "@/lib/stickers/meta-messenger-server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

type GraphPayload = { recipient_id?: string; message_id?: string; error?: { message?: string; code?: number; error_subcode?: number; type?: string } };

function graphMessage(payload: GraphPayload, fallback: string) {
  return payload.error?.message?.trim()?.slice(0, 600) || fallback;
}

/** Send one first-party Meta sticker by its catalog sticker_id. */
export async function POST(request: NextRequest) {
  let receipt: { businessId: string; requestId: string } | null = null;
  let dispatchStarted = false;
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new MetaStickerError("A same-origin signed-in request is required.", 403);
    let body: any;
    try {
      const raw = await request.text();
      if (raw.length > 8000) throw new MetaStickerError("Request too large.", 413);
      body = JSON.parse(raw);
    } catch (error) {
      if (error instanceof MetaStickerError) throw error;
      throw new MetaStickerError("Invalid sticker request.");
    }
    const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
    const requestId = typeof body?.requestId === "string" ? body.requestId : "";
    const stickerId = typeof body?.stickerId === "string" ? body.stickerId.trim() : "";
    const previewUrl = typeof body?.previewUrl === "string" && /^https:\/\//i.test(body.previewUrl) && body.previewUrl.length <= 4096 ? body.previewUrl : null;
    const label = typeof body?.label === "string" ? body.label.trim().slice(0, 160) : "Messenger sticker";
    if (!conversationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) || !/^\d{1,40}$/.test(stickerId)) {
      throw new MetaStickerError("A conversation, Meta sticker ID and unique requestId are required.");
    }

    const scope = await metaStickerConversation(conversationId, true);
    if (body.replyToMessageId !== undefined && (typeof body.replyToMessageId !== "string" || body.replyToMessageId.length > 100)) throw new MetaStickerError("Invalid reply message ID.");
    const replyToMessageId = body.replyToMessageId?.trim() || null;
    const fingerprint = createHash("sha256").update(JSON.stringify([scope.conversation.id, scope.member.id, scope.page.platform_account_id, scope.contact.platform_user_id, stickerId, ...(replyToMessageId ? [replyToMessageId] : [])])).digest("hex");
    const key = { businessId: scope.businessId, requestId };
    const previous = await supabaseAdmin.from("facebook_sticker_sends").select("status,fingerprint,result,http_status")
      .eq("business_id", key.businessId).eq("request_id", key.requestId).maybeSingle();
    if (previous.error) throw new MetaStickerError("Apply the existing TENH sticker-send receipt migration before sending Meta stickers.", 503, "STICKER_STORAGE_REQUIRED");
    if (previous.data) {
      if (previous.data.fingerprint !== fingerprint) throw new MetaStickerError("This send request belongs to a different sticker or customer.", 409);
      if (previous.data.status === "completed") return json(previous.data.result, 200);
      throw new MetaStickerError("This sticker send has already been attempted. Check Messenger before sending again; TENH will not duplicate it.", 409, "STICKER_SEND_ALREADY_ATTEMPTED");
    }

    const blocked = await facebookSendBlockReason({ businessId: scope.businessId, socialAccountId: scope.page.id, contactId: scope.contact.id });
    if (blocked) throw new MetaStickerError(blocked, 403);

    let policy: Awaited<ReturnType<typeof getFacebookMessengerReplyPolicy>>;
    try { policy = await getFacebookMessengerReplyPolicy(scope.conversation.id); }
    catch { throw new MetaStickerError("TENH could not safely verify whether Facebook allows another message. Please try again.", 503, "MESSENGER_POLICY_CHECK_FAILED"); }
    if (policy.windowState === "waiting_for_customer_reply") throw new MetaStickerError("Waiting for customer reply. Meta allows only one private Messenger reply after a Facebook comment.", 409, "WAITING_FOR_CUSTOMER_REPLY");
    if (policy.windowState === "expired") throw new MetaStickerError("The 7-day Messenger support window has expired. Wait for the customer to message again.", 409, "MESSENGER_WINDOW_EXPIRED");
    if (policy.windowState === "unknown") throw new MetaStickerError("TENH could not safely verify this Messenger conversation yet. Refresh it and try again.", 409, "MESSENGER_POLICY_UNKNOWN");
    // Meta's Sticker API explicitly limits native stickers to the standard window.
    if (policy.windowState !== "standard") throw new MetaStickerError("Messenger stickers can only be sent within 24 hours of the customer’s last Messenger message. Wait for a new message from the customer.", 409, "META_STICKER_STANDARD_WINDOW_REQUIRED");

    const replyContext = await getFacebookSendReply(replyToMessageId, scope.businessId, scope.conversation.id);
    const inserted = await supabaseAdmin.from("facebook_sticker_sends").insert({
      business_id: key.businessId, request_id: key.requestId, conversation_id: scope.conversation.id,
      member_id: scope.member.id, fingerprint, status: "pending",
    });
    if (inserted.error) throw new MetaStickerError("This sticker send is already in progress, or its receipt could not be saved. Check the conversation before retrying.", 409, "STICKER_SEND_IN_PROGRESS");
    receipt = key;

    const pageId = scope.page.platform_account_id;
    const graphVersion = process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";
    let pageAccessToken = await getFacebookPageAccessToken(pageId);
    const sendUrl = new URL(`https://graph.facebook.com/${graphVersion}/${pageId}/messages`);
    const attempt = async () => {
      sendUrl.searchParams.set("access_token", pageAccessToken);
      const response = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: scope.contact.platform_user_id },
          messaging_type: "RESPONSE",
          message: { sticker_id: stickerId },
          ...(replyContext ? { reply_to: replyContext.reply_to } : {}),
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      let payload: GraphPayload = {};
      try { payload = await response.json(); } catch { /* validated below */ }
      return { response, payload };
    };

    dispatchStarted = true;
    let send = await attempt();
    if ((!send.response.ok || send.payload.error) && isFacebookAccessTokenError(send.payload.error)) {
      pageAccessToken = await refreshFacebookPageAccessToken(pageId);
      send = await attempt();
    }
    const facebookMessageId = send.payload.message_id?.trim();
    if (!send.response.ok || !facebookMessageId) {
      const providerError = graphMessage(send.payload, "Meta did not accept this native sticker.");
      const output = { success: false, code: "META_STICKER_SEND_REJECTED", error: providerError };

      await supabaseAdmin.from("facebook_sticker_sends").update({ status: "rejected", result: output, http_status: send.response.status || 502, updated_at: new Date().toISOString() })
        .eq("business_id", key.businessId).eq("request_id", key.requestId);
      return json(output, send.response.ok ? 502 : send.response.status);
    }

    const now = new Date().toISOString();
    let stored: any = null;
    const existing = await supabaseAdmin.from("messages").select("*").eq("business_id", scope.businessId).eq("platform_message_id", facebookMessageId).maybeSingle();
    if (existing.data) {
      const updated = await supabaseAdmin.from("messages").update({ sent_by_member_id: scope.member.id }).eq("id", existing.data.id).eq("business_id", scope.businessId).select("*").single();
      stored = updated.data || existing.data;
    } else if (!existing.error) {
      const created = await supabaseAdmin.from("messages").insert({
        business_id: scope.businessId,
        conversation_id: scope.conversation.id,
        platform_message_id: facebookMessageId,
        sender_platform_id: pageId,
        recipient_platform_id: scope.contact.platform_user_id,
        direction: "outgoing",
        message_type: "sticker",
        message_text: "Sent a sticker",
        attachment_url: previewUrl,
        sent_by_member_id: scope.member.id,
        delivery_status: "sent",
        delivered_at: null,
        seen_at: null,
        is_echo: false,
        raw_payload: { ...replyContext, tenh_meta_sticker: { sticker_id: stickerId, label, native: true }, facebook_response: send.payload },
        platform_created_at: now,
      }).select("*").single();
      if (created.error?.code === "23505") {
        const raced = await supabaseAdmin.from("messages").select("*").eq("business_id", scope.businessId).eq("platform_message_id", facebookMessageId).maybeSingle();
        stored = raced.data || null;
        if (stored?.id) await supabaseAdmin.from("messages").update({ sent_by_member_id: scope.member.id }).eq("id", stored.id).eq("business_id", scope.businessId);
      } else stored = created.data || null;
    }

    let replyWarning: string | undefined;
    if (replyContext && stored?.id) {
      try {
        stored = await mutateMessageMetadata(supabaseAdmin, { businessId: scope.businessId, conversationId: scope.conversation.id, messageId: stored.id },
          current => ({ raw_payload: { ...(current.raw_payload || {}), ...replyContext } }));
      } catch { replyWarning = "Sticker sent, but TENH could not save its reply reference. Do not resend."; }
    }
    const output = { success: true, ...(replyWarning ? { warning: replyWarning } : {}), messageId: facebookMessageId, recipientId: send.payload.recipient_id || scope.contact.platform_user_id,
      delivery: "native_sticker", stickerProvider: "meta", stickerId, ...(stored ? { message: stored } : {}) };
    const saved = await supabaseAdmin.from("facebook_sticker_sends").update({ status: "completed", result: output, http_status: 200, updated_at: now })
      .eq("business_id", key.businessId).eq("request_id", key.requestId);
    return json({ ...output, ...(saved.error ? { warning: "Sticker sent, but its receipt needs synchronization. Do not resend." } : {}) });
  } catch (error) {
    if (receipt) {
      try { await supabaseAdmin.from("facebook_sticker_sends").update({ status: dispatchStarted ? "uncertain" : "rejected", updated_at: new Date().toISOString() })
        .eq("business_id", receipt.businessId).eq("request_id", receipt.requestId); } catch { /* receipt remains a duplicate fence */ }
    }
    const known = error instanceof MetaStickerError || error instanceof FacebookReplyError;
    return json({ success: false, code: error instanceof MetaStickerError ? error.code : error instanceof FacebookReplyError ? "INVALID_MESSENGER_REPLY" : "META_STICKER_SEND_FAILED",
      error: dispatchStarted && !known ? "The result of this sticker send is uncertain. Check Messenger; TENH will not automatically send it again." : known ? error.message : "Sticker could not be sent." }, known ? error.status : 502);
  }
}
