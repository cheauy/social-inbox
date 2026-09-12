import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboxMessage } from "../../types/inbox";

export class MessageMutationError extends Error {
  constructor(message: string, readonly status = 500) { super(message); }
}

/** Compare-and-swap prevents pin/edit/reply/delete from losing concurrent metadata.
 * Caller must authenticate, authorize the conversation, and supply all three IDs.
 * Does not touch delivery/seen columns or change the message timestamp.
 */
export async function mutateMessageMetadata(
  db: SupabaseClient,
  scope: { businessId: string; conversationId: string; messageId: string },
  patch: (current: InboxMessage) => Record<string, unknown>,
): Promise<InboxMessage> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await db.from("messages").select("*")
      .eq("business_id", scope.businessId).eq("conversation_id", scope.conversationId)
      .eq("id", scope.messageId).maybeSingle();
    if (error) throw new MessageMutationError("Unable to read the message.");
    if (!data) throw new MessageMutationError("Message was not found in this conversation.", 404);
    const current = data as InboxMessage;
    let query = db.from("messages").update(patch(current))
      .eq("business_id", scope.businessId).eq("conversation_id", scope.conversationId)
      .eq("id", scope.messageId);
    query = current.raw_payload == null
      ? query.is("raw_payload", null)
      : query.eq("raw_payload", JSON.stringify(current.raw_payload));
    const updated = await query.select("*").maybeSingle();
    if (updated.error) throw new MessageMutationError("Unable to update the message.");
    if (updated.data) return updated.data as InboxMessage;
  }
  throw new MessageMutationError("This message changed while saving. Please try again.", 409);
}
