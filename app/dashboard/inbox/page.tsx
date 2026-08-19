import { InboxView } from "@/components/inbox/inbox-view";
import {
  getConversations,
  getInboxConversationScope,
} from "@/lib/inbox/get-conversations";
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
    channel?: string | string[];
    page?: string | string[];
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

  const inboxScope =
    await getInboxConversationScope();

  const [
    allConversations,
    teamMembers,
  ] = await Promise.all([
    getConversations(
      inboxScope.accessibleBusinessIds,
    ),
    getTeamMembers(),
  ]);

  /*
   * V3.11.4 generic channel selector.
   *
   * `page` is the legacy V3.1.17 Facebook Page key.
   * Keep accepting it so old Inbox/Page links continue to work.
   */
  const selectedChannelId =
    getSingleSearchParam(
      params.channel,
    ) ??
    getSingleSearchParam(
      params.page,
    );

  const channelConversations =
    selectedChannelId
      ? allConversations.filter(
          (conversation) =>
            conversation.social_account?.id ===
            selectedChannelId,
        )
      : allConversations;

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
      ? channelConversations
      : channelConversations.filter(
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
      ? channelConversations.find(
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
    null;

  const messages =
    activeConversationId
      ? await getMessages(
          activeConversationId,
        )
      : [];

  const statusCounts = {
    all: channelConversations.length,

    open:
      channelConversations.filter(
        (conversation) =>
          conversation.status ===
          "open",
      ).length,

    pending:
      channelConversations.filter(
        (conversation) =>
          conversation.status ===
          "pending",
      ).length,

    resolved:
      channelConversations.filter(
        (conversation) =>
          conversation.status ===
          "resolved",
      ).length,

    closed:
      channelConversations.filter(
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
          currentBusinessId={
            inboxScope.currentBusinessId
          }
          accessibleBusinessIds={
            inboxScope.accessibleBusinessIds
          }
        />
      </div>
    </div>
  );
}