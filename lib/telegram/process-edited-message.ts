import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mutateMessageMetadata } from "@/lib/inbox/mutate-message-metadata";
import { isMessageDeleted, record } from "@/lib/inbox/message-actions";
import type { TelegramUpdate } from "@/lib/telegram/types";
import type { InboxMessage } from "@/types/inbox";
class IgnoreEdit extends Error {}
export async function processTelegramEditedText({ update, businessId, connectionId }: {
  update: TelegramUpdate; businessId: string; connectionId: string;
}) {
  const message = update.edited_message;
  if (!message || message.chat.type !== "private" || message.from?.is_bot === true || !message.text?.trim()) return { edited: false, ignored: true };
  const platformId = `telegram:${String(message.chat.id)}:${message.message_id}`;
  const { data, error } = await supabaseAdmin.from("messages")
    .select("id,conversation_id,message_type,raw_payload,platform_created_at,conversation:conversations!inner(social_account_id)")
    .eq("business_id", businessId).eq("platform_message_id", platformId).eq("conversation.social_account_id", connectionId).maybeSingle();
  if (error) throw new Error("Unable to read Telegram edit target.");
  if (!data) return { edited: false, ignored: true, reason: "message_not_found" };
  const editedAt = typeof message.edit_date === "number" && Number.isFinite(message.edit_date) ? new Date(message.edit_date * 1000).toISOString() : new Date().toISOString();
  let updated: InboxMessage;
  try {
    updated = await mutateMessageMetadata(supabaseAdmin, { businessId, conversationId: data.conversation_id, messageId: data.id }, current => {
      if (isMessageDeleted(current)) throw new IgnoreEdit("message_deleted");
      if (current.message_type !== "text") throw new IgnoreEdit("non_text_message");
      const raw = record(current.raw_payload);
      if (Date.parse(String(record(raw.tenh_edit).edited_at || "")) > Date.parse(editedAt)) throw new IgnoreEdit("older_edit");
      // Merge the latest payload inside compare-and-swap, preserving pins/reply refs.
      return { message_text: message.text!.trim(), raw_payload: { ...raw, ...update, tenh_edit: { source: "telegram", edited_at: editedAt } } };
    });
  } catch (e) { if (e instanceof IgnoreEdit) return { edited: false, ignored: true, reason: e.message }; throw e; }
  if (data.platform_created_at) {
    await supabaseAdmin.from("conversations").update({ last_message_text: updated.message_text, updated_at: editedAt })
      .eq("id", data.conversation_id).eq("business_id", businessId).eq("social_account_id", connectionId).eq("last_message_at", data.platform_created_at);
  }
  return { edited: true, messageId: data.id, messageText: updated.message_text };
}
