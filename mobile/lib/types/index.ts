export type { InboxConversation, InboxMessage, InboxContact, SavedReply, ConversationStatus } from "../../../types/inbox";

export type Workspace = { memberId: string; businessId: string; businessName: string; role: string; subscriptionOperational: boolean };
export type Member = { id: string; full_name: string; email: string; role: string; profile_picture_url: string | null };
