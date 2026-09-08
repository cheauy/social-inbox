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

  /*
   * Every status goes to the client, and the client filters.
   *
   * The status filter used to be applied here, so switching status was a
   * server round trip -- measured at 1.6 to 2.2 seconds in development. The
   * browser then had only that status's conversations, which is what made
   * switching from one status to another show nothing at all until the server
   * answered: a conversation has exactly one status, so filtering Open's
   * conversations for Closed always finds none.
   *
   * Sending all of them costs almost nothing. This workspace holds 466 open,
   * 5 pending and 4 closed, and All Conversations -- the default view --
   * already sends all 475. Filtering to Closed now sends the same 475 rather
   * than 4, and in exchange every status switch is instant and needs no
   * loading state at all.
   *
   * The URL still changes, so a filtered view stays shareable, and
   * statusCounts below are still counted here. Only the filtering moved.
   */
  const requestedConversationId =
    getSingleSearchParam(
      params.conversation,
    );

  const requestedConversation =
    requestedConversationId
      ? channelConversations.find(
          (conversation) =>
            conversation.id ===
            requestedConversationId,
        ) ?? null
      : null;

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
            channelConversations
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