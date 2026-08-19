import type {
  ConversationStatus,
  InboxConversation,
  InboxMessage,
  TeamMember,
} from "@/types/inbox";

export type StatusFilter = ConversationStatus | "all";

export type StatusCounts = Record<StatusFilter, number>;

export type InboxViewProps = {
  conversations: InboxConversation[];
  activeConversationId: string | null;
  messages: InboxMessage[];
  activeStatus: StatusFilter;
  statusCounts: StatusCounts;
  teamMembers: TeamMember[];
  currentBusinessId: string;
  accessibleBusinessIds: string[];
};
