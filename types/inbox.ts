export type ConversationStatus =
  | "open"
  | "pending"
  | "resolved"
  | "closed"
  | "spam";

export type MessageDirection =
  | "incoming"
  | "outgoing";

export type TeamMemberRole =
  | "owner"
  | "admin"
  | "agent";

export type TagColor = string;

export type TeamMember = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  profile_picture_url: string | null;
};

export type SavedReplyAttachmentType =
  | "image"
  | "video";

export type SavedReplyAttachment = {
  id: string;
  saved_reply_id: string;
  attachment_type: SavedReplyAttachmentType;
  storage_path: string;
  public_url: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  sort_index: number;
  created_at: string;
};

export type CustomerTag = {
  id: string;
  business_id: string;
  name: string;
  color: TagColor;
  sort_index: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ConversationActivityType =
  | "assigned"
  | "unassigned"
  | "status_changed"
  | "tag_added"
  | "tag_removed"
  | "customer_updated"
  | "note_added"
  | "note_updated"
  | "note_deleted"
  | "reminder_created";

export type ConversationActivity = {
  id: string;
  business_id: string;
  conversation_id: string;
  contact_id: string | null;
  actor_member_id: string | null;

  activity_type:
    ConversationActivityType;

  title: string;
  description: string | null;

  customer_name: string | null;
  actor_name: string | null;

  actor_profile_picture_url:
    string | null;

  metadata: Record<string, unknown>;

  created_at: string;
};

export type InboxContact = {
  id: string;
  business_id: string;
  full_name: string | null;
  profile_picture_url: string | null;
  platform_user_id: string;
  phone: string | null;
  email: string | null;
  company_name: string | null;
  customer_note: string | null;
  created_at: string;
  last_contact_at: string | null;
  tags: CustomerTag[];
};

export type SavedReply = {
  id: string;
  business_id: string;
  title: string;
  shortcut: string | null;
  message_text: string;
  category: string | null;
  sort_index: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;

  attachments: SavedReplyAttachment[];
};

export type ContactNote = {
  id: string;
  contact_id: string;
  author_id: string;
  note_text: string;
  created_at: string;
  updated_at: string;
  author: TeamMember | null;
};

export type InboxConversation = {
  id: string;
  status: ConversationStatus;
  unread_count: number;
  last_message_text: string | null;
  last_message_at: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  assigned_member: TeamMember | null;
  contact: InboxContact | null;
  seen_by_member?: TeamMember | null;
  seen_at?: string | null;
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
