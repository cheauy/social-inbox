/*
 * The phone's conversation is the projection the bootstrap sends, not the web
 * Inbox's full row -- see MobileConversation for what is left out and why.
 * Aliased rather than renamed everywhere so a screen reads the same on both
 * sides, and so TypeScript is the thing that notices if the phone starts
 * wanting a field the endpoint no longer carries.
 */
export type { MobileConversation as InboxConversation } from "../../../types/inbox";
export type { InboxMessage, InboxContact, SavedReply, SavedReplyAttachment, ConversationStatus } from "../../../types/inbox";

export type Workspace = { memberId: string; businessId: string; businessName: string; role: string; subscriptionOperational: boolean };
export type Member = { id: string; full_name: string; email: string; role: string; profile_picture_url: string | null };

/*
 * A team chat room, as /api/team-chat/rooms returns it.
 *
 * badge_count is the number to draw: it is the unread count normally, and the
 * mention count in a muted room -- the server's rule, so a muted room still
 * says something when somebody has actually asked for you.
 */
export type TeamRoom = {
  id: string;
  icon?: "people" | "megaphone" | "briefcase" | "headset" | "cart" | "rocket" | "heart" | "star";
  name: string | null;
  description: string | null;
  is_general: boolean;
  is_muted: boolean;
  member_ids: string[];
  member_count: number;
  unread_count: number;
  mention_count: number;
  badge_count: number;

  /* The newest thing said in the room, for the list to show. */
  last_message: {
    id: string;
    text: string;
    sender_name: string;
    created_at: string;
  } | null;
};
