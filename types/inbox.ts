export type ConversationStatus =
  | "open"
  | "pending"
  | "resolved"
  | "spam";

export type MessageDirection =
  | "incoming"
  | "outgoing";

export type InboxConversation = {
  id: string;
  status: ConversationStatus;
  unread_count: number;
  last_message_text: string | null;
  last_message_at: string | null;

  contact: {
    id: string;
    full_name: string | null;
    profile_picture_url: string | null;
    platform_user_id: string;
  } | null;

  social_account: {
    id: string;
    account_name: string;
    platform_account_id: string;
  } | null;
};

export type InboxMessage = {
  id: string;
  platform_message_id: string;
  sender_platform_id: string;
  recipient_platform_id: string;
  direction: MessageDirection;
  message_type: string;
  message_text: string | null;
  attachment_url: string | null;
  platform_created_at: string | null;
  created_at: string;
};