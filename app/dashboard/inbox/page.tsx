import { InboxView } from "@/components/inbox/inbox-view";
import { getConversations } from "@/lib/inbox/get-conversations";
import { getMessages } from "@/lib/inbox/get-messages";
import { getTeamMembers } from "@/lib/inbox/get-team-members";

import type {
  ConversationStatus,
} from "@/types/inbox";

const validStatuses =
  new Set<ConversationStatus>([
    "open",
    "pending",
    "resolved",
    "closed",
    "spam",
  ]);

type InboxPageProps = {
  searchParams: Promise<{
    conversation?: string | string[];
    status?: string | string[];
  }>;
};

function getSingleSearchParam(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }

  return value?.trim() || null;
}

export default async function InboxPage({
  searchParams,
}: InboxPageProps) {
  const params = await searchParams;

  const [
    allConversations,
    teamMembers,
  ] = await Promise.all([
    getConversations(),
    getTeamMembers(),
  ]);

  const requestedStatus =
    getSingleSearchParam(
      params.status,
    );

  const activeStatus:
    | ConversationStatus
    | "all" =
    requestedStatus &&
    validStatuses.has(
      requestedStatus as ConversationStatus,
    )
      ? (requestedStatus as ConversationStatus)
      : "all";

  const filteredConversations =
    activeStatus === "all"
      ? allConversations
      : allConversations.filter(
          (conversation) =>
            conversation.status ===
            activeStatus,
        );

  const requestedConversationId =
    getSingleSearchParam(
      params.conversation,
    );

  /*
   * Find the URL-requested conversation from the
   * complete list—not only from the filtered list.
   */
  const requestedConversation =
    requestedConversationId
      ? allConversations.find(
          (conversation) =>
            conversation.id ===
            requestedConversationId,
        ) ?? null
      : null;

  /*
   * If a status filter hides the requested
   * conversation, include it temporarily.
   */
  const visibleConversations =
    requestedConversation &&
    !filteredConversations.some(
      (conversation) =>
        conversation.id ===
        requestedConversation.id,
    )
      ? [
          requestedConversation,
          ...filteredConversations,
        ]
      : filteredConversations;

  /*
   * This exact ID controls both the header
   * and the loaded messages.
   */
  const activeConversationId =
    requestedConversation?.id ??
    visibleConversations[0]?.id ??
    null;

  const messages =
    activeConversationId
      ? await getMessages(
          activeConversationId,
        )
      : [];

  const statusCounts = {
    all: allConversations.length,

    open:
      allConversations.filter(
        (conversation) =>
          conversation.status ===
          "open",
      ).length,

    pending:
      allConversations.filter(
        (conversation) =>
          conversation.status ===
          "pending",
      ).length,

    resolved:
      allConversations.filter(
        (conversation) =>
          conversation.status ===
          "resolved",
      ).length,

    closed:
      allConversations.filter(
        (conversation) =>
          conversation.status ===
          "closed",
      ).length,

    spam:
      allConversations.filter(
        (conversation) =>
          conversation.status ===
          "spam",
      ).length,
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <InboxView
          key={
            activeConversationId ??
            "empty-inbox"
          }
          conversations={
            visibleConversations
          }
          activeConversationId={
            activeConversationId
          }
          messages={messages}
          activeStatus={activeStatus}
          statusCounts={statusCounts}
          teamMembers={teamMembers}
        />
      </div>
    </div>
  );
}