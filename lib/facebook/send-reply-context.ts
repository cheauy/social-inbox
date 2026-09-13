import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createReplyContext, getMessageActions } from "@/lib/inbox/message-actions";
import type { InboxMessage } from "@/types/inbox";

export class FacebookReplyError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Resolve a local row under the authorized workspace and exact conversation. */
export async function getFacebookSendReply(value: unknown, businessId: string, conversationId: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim() || value.length > 100) throw new FacebookReplyError("Invalid reply message ID.");
  const { data: target, error } = await supabaseAdmin.from("messages").select("*")
    .eq("id", value.trim()).eq("business_id", businessId).eq("conversation_id", conversationId).maybeSingle();
  if (error) throw new FacebookReplyError("Unable to load the selected reply.", 503);
  const mid = target?.platform_message_id;
  if (!target || typeof mid !== "string" || !mid.trim() || mid.length > 500 || mid.startsWith("telegram:") || !getMessageActions(target as InboxMessage, "facebook").reply) {
    throw new FacebookReplyError("The selected reply is not an available Messenger message in this conversation.");
  }
  const context = createReplyContext(target as InboxMessage, "facebook");
  return {
    reply_to: { mid },
    tenh_reply: context,
    tenh_facebook_reply: { platformMessageId: mid, conversationId, text: context.preview_text },
  };
}

export function requireFacebookReplyWindow(reply: unknown, windowState: string) {
  if (reply && windowState !== "standard") throw new FacebookReplyError("Messenger quoted replies require the 24-hour messaging window. Cancel Reply to use the available support message option.", 409);
}
