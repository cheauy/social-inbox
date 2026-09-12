import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { POST as sendExistingFacebookAttachment } from "@/app/api/facebook/send-attachment/route";
import { stickerConversation, verifySelection, downloadSticker, registerStickerSend, StipopError } from "@/lib/stickers/stipop-server";
import { getFacebookMessengerReplyPolicy } from "@/lib/facebook/messenger-reply-policy";
import { facebookSendBlockReason } from "@/lib/facebook/customer-block";
import { supabaseAdmin } from "@/lib/supabase/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** Adapter into the EXISTING attachment pipeline: its token, moderation,
 * messaging-window, media storage and webhook/echo behavior remain authoritative.
 * A durable receipt prevents retries from re-sending an uncertain POST. */
export async function POST(request: NextRequest) {
  let receipt: { businessId: string; requestId: string } | null = null;
  let dispatchStarted = false;
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new StipopError("A same-origin signed-in request is required.", 403);
    let body; try { const raw = await request.text(); if (raw.length > 16000) throw new StipopError("Request too large.", 413); body = JSON.parse(raw); } catch (error) { if (error instanceof StipopError) throw error; throw new StipopError("Invalid sticker request."); }
    if (!body || typeof body.conversationId !== "string" || typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) throw new StipopError("A conversation and unique requestId are required.");
    const scope = await stickerConversation(body.conversationId, true);
    const selection = verifySelection(body.selectionToken, scope);
    const fingerprint = createHash("sha256").update(JSON.stringify([scope.conversation.id, scope.member.id, selection.stickerId, selection.imageUrl])).digest("hex");
    const key = { businessId: scope.businessId, requestId: body.requestId };
    const previous = await supabaseAdmin.from("facebook_sticker_sends").select("status,fingerprint,result,http_status")
      .eq("business_id", key.businessId).eq("request_id", key.requestId).maybeSingle();
    if (previous.error) throw new StipopError("Apply the existing-upgrade SQL migration before sending online stickers.", 503, "STICKER_STORAGE_REQUIRED");
    if (previous.data) {
      if (previous.data.fingerprint !== fingerprint) throw new StipopError("This send request belongs to a different sticker or customer.", 409);
      if (previous.data.status === "completed") return response(previous.data.result, 200);
      throw new StipopError("This send has already been attempted. Check Messenger before creating a new send; TENH will not send it twice.", 409, "STICKER_SEND_ALREADY_ATTEMPTED");
    }
    // Preflight before image download or receipt creation. The existing route checks again.
    const blocked = await facebookSendBlockReason({ businessId: scope.businessId, socialAccountId: scope.page.id, contactId: scope.contact.id });
    if (blocked) throw new StipopError(blocked, 403);
    const policy = await getFacebookMessengerReplyPolicy(scope.conversation.id);
    if (!["standard", "human_agent", "private_reply_available"].includes(policy.windowState)) throw new StipopError("The Messenger reply window is unavailable. Wait for a new customer message.", 409, "MESSENGER_WINDOW_EXPIRED");
    const image = await downloadSticker(selection);
    const inserted = await supabaseAdmin.from("facebook_sticker_sends").insert({ business_id: key.businessId, request_id: key.requestId, conversation_id: scope.conversation.id, member_id: scope.member.id, fingerprint, status: "pending" });
    if (inserted.error) throw new StipopError("This send is already in progress, or its receipt could not be saved. Check the conversation before retrying.", 409, "STICKER_SEND_IN_PROGRESS");
    receipt = key;
    const form = new FormData();
    form.set("conversationId", scope.conversation.id); form.set("recipientId", scope.contact.platform_user_id); form.set("kind", "image");
    form.set("clientRequestId", `optimistic:attachment:${body.requestId}`); form.set("file", image, image.name);
    const headers = new Headers(request.headers); headers.delete("content-type"); headers.delete("content-length");
    const internal = new NextRequest(new URL("/api/facebook/send-attachment", request.url), { method: "POST", headers, body: form });
    dispatchStarted = true;
    const resultResponse = await sendExistingFacebookAttachment(internal);
    const result = await resultResponse.json();
    const success = resultResponse.ok && result.success === true && typeof result.messageId === "string";
    // The delegate can fail after Meta has accepted the send (e.g. storage).
    // Never declare such a response safe to retry automatically.
    const output = success ? { ...result, delivery: "image_attachment", stickerProvider: "stipop" } : {
      success: false, code: "STICKER_SEND_CHECK_REQUIRED", error: "The sticker send was not fully confirmed. Check this conversation in Messenger before sending again.",
      details: typeof result.error === "string" ? result.error.slice(0, 500) : undefined,
    };
    const saved = await supabaseAdmin.from("facebook_sticker_sends").update({ status: success ? "completed" : "uncertain", result: output, http_status: success ? 200 : 502, updated_at: new Date().toISOString() })
      .eq("business_id", key.businessId).eq("request_id", key.requestId);
    if (success) {
      // Analytics failure is never a reason to resend a customer message.
      try { await registerStickerSend(selection, scope); } catch { /* Noncritical vendor analytics. */ }
      return response({ ...output, ...(saved.error ? { warning: "Message sent, but its receipt needs synchronization. Do not resend." } : {}) });
    }
    return response(output, 502);
  } catch (error) {
    if (receipt) {
      try { await supabaseAdmin.from("facebook_sticker_sends").update({ status: dispatchStarted ? "uncertain" : "rejected", updated_at: new Date().toISOString() }).eq("business_id", receipt.businessId).eq("request_id", receipt.requestId); } catch { /* The pending row still prevents duplicate delivery. */ }
    }
    return response({ success: false, code: error instanceof StipopError ? error.code : "STICKER_SEND_FAILED",
      error: dispatchStarted ? "The result of this send is uncertain. Check Messenger; TENH will not automatically send it again." : error instanceof StipopError ? error.message : "Sticker could not be prepared. Nothing was sent." }, error instanceof StipopError ? error.status : 502);
  }
}
