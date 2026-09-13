import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mutateMessageMetadata } from "@/lib/inbox/mutate-message-metadata";
import { messengerWebhookEmoji, withMessengerReaction } from "./message-reactions";
import type { FacebookMessagingEvent } from "@/types/facebook";

/** Called only after the existing webhook signature verification. No new messages
 * or unread/sound events: update metadata through the existing Realtime stream. */
export async function processFacebookMessageReaction(event: FacebookMessagingEvent, pageId?: string) {
  const reaction = event.reaction, sender = event.sender?.id, recipient = event.recipient?.id;
  if (!pageId || !sender || !recipient || !reaction?.mid || !["react", "unreact"].includes(reaction.action ?? "")) return;
  if (sender !== pageId && recipient !== pageId) return;
  if (typeof event.timestamp !== "number" || !Number.isFinite(event.timestamp) || event.timestamp <= 0) return;
  const actor = sender === pageId ? "page" : "customer";
  const customerId = actor === "page" ? recipient : sender;
  const emoji = reaction.action === "unreact" ? null : messengerWebhookEmoji(reaction);
  if (reaction.action === "react" && !emoji) return;
  const pages = await supabaseAdmin.from("social_accounts").select("id,business_id")
    .eq("platform", "facebook").eq("platform_account_id", pageId).eq("is_active", true);
  if (pages.error) throw new Error("Unable to resolve the Page for a reaction.");
  for (const page of pages.data ?? []) {
    const found = await supabaseAdmin.from("messages").select("id,conversation_id")
      .eq("business_id", page.business_id).eq("platform_message_id", reaction.mid).maybeSingle();
    if (found.error) throw new Error("Unable to resolve the reacted message.");
    if (!found.data) continue;
    const conversation = await supabaseAdmin.from("conversations").select("id,contact_id")
      .eq("business_id", page.business_id).eq("id", found.data.conversation_id).eq("social_account_id", page.id).maybeSingle();
    if (conversation.error) throw new Error("Unable to verify the reaction conversation.");
    if (!conversation.data) continue;
    const contact = await supabaseAdmin.from("contacts").select("id").eq("business_id", page.business_id)
      .eq("id", conversation.data.contact_id).eq("platform", "facebook").eq("platform_user_id", customerId).maybeSingle();
    if (contact.error) throw new Error("Unable to verify the reaction sender.");
    if (!contact.data) continue;
    await mutateMessageMetadata(supabaseAdmin, { businessId: page.business_id, conversationId: found.data.conversation_id, messageId: found.data.id }, current => ({
      raw_payload: withMessengerReaction(current.raw_payload, actor, { emoji, timestamp: event.timestamp! }),
    }));
  }
}
