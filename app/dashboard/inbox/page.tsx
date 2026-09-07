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
    workspace?: string | string[];
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

  /*
   * V3.11.4 generic channel selector.
   *
   * `page` is the legacy V3.1.17 Facebook Page key.
   * Keep accepting it so old Inbox/Page links continue to work.
   */
  const selectedWorkspaceId =
    getSingleSearchParam(
      params.workspace,
    );

  const selectedChannelId =
    getSingleSearchParam(
      params.channel,
    ) ??
    getSingleSearchParam(
      params.page,
    );

  /*
   * The channel and workspace filters go to the query rather than running
   * over the result. Both used to be applied here, after loading every
   * conversation in every workspace the member can reach, so opening one
   * channel did the same work as opening all of them and then discarded most
   * of it. getConversations applies exactly these conditions.
   */
  const [
    channelConversations,
    teamMembers,
  ] = await Promise.all([
    getConversations(
      inboxScope.accessibleBusinessIds,
      {
        channelId: selectedChannelId,
        workspaceId: selectedWorkspaceId,
      },
    ),
    getTeamMembers(
      inboxScope.accessibleBusinessIds,
    ),
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
      channelConversations.filter(
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