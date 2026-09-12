import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { facebookReplyTarget } from "./native-reply";
import { getMessageSummary } from "@/lib/inbox/message-actions";
import type { InboxMessage } from "@/types/inbox";
export async function captureFacebookNativeReply(event: unknown, scope: { businessId: string; conversationId: string; messageId: string }) {
  const mid = facebookReplyTarget(event);
  if (!mid || mid === scope.messageId) return null;
  try {
  const { data, error } = await supabaseAdmin.from("messages").select("*")
    .eq("business_id", scope.businessId).eq("conversation_id", scope.conversationId).eq("platform_message_id", mid).maybeSingle();
  if (error || !data) return null; // A missing parent must not delay message delivery.
  return { platformMessageId: mid, conversationId: scope.conversationId, text: getMessageSummary(data as InboxMessage).slice(0, 500) };
  } catch { return null; } // Quote enrichment must never prevent delivery.
}
