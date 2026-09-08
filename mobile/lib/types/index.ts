/*
 * The phone's conversation is the projection the bootstrap sends, not the web
 * Inbox's full row -- see MobileConversation for what is left out and why.
 * Aliased rather than renamed everywhere so a screen reads the same on both
 * sides, and so TypeScript is the thing that notices if the phone starts
 * wanting a field the endpoint no longer carries.
 */
export type { MobileConversation as InboxConversation } from "../../../types/inbox";
export type { InboxMessage, InboxContact, SavedReply, ConversationStatus } from "../../../types/inbox";

export type Workspace = { memberId: string; businessId: string; businessName: string; role: string; subscriptionOperational: boolean };
export type Member = { id: string; full_name: string; email: string; role: string; profile_picture_url: string | null };
