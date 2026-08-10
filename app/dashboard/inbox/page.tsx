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
    conversation?:
      | string
      | string[];
    status?:
      | string
      | string[];
    view?:
      | string
      | string[];
  }>;
};

function getSingleSearchParam(
  value:
    | string
    | string[]
    | undefined,
): string | null {
  if (
    Array.isArray(
      value,
    )
  ) {
    return (
      value[0]?.trim() ||
      null
    );
  }

  return (
    value?.trim() ||
    null
  );
}

export default async function InboxPage({
  searchParams,
}: InboxPageProps) {
  const params =
    await searchParams;

  const requestedConversationId =
    getSingleSearchParam(
      params.conversation,
    );

  /*
   * V3.1.1 performance:
   * On a normal conversation click we already know the requested ID
   * from the URL, so load its messages in parallel with the Inbox
   * conversation/team data instead of waiting for getConversations()
   * to finish first.
   */
  const [
    allConversationsResult,
    teamMembersResult,
    requestedMessagesResult,
  ] =
    await Promise.all([
      getConversations(),
      getTeamMembers(),
      requestedConversationId
        ? getMessages(
            requestedConversationId,
          )
        : Promise.resolve(
            null,
          ),
    ]);

  /*
   * V3.1.5 defensive normalization.
   * Older helper versions / partial dev hot reloads must never
   * make the Inbox crash by calling .length/.filter on undefined.
   */
  const allConversations =
    Array.isArray(
      allConversationsResult,
    )
      ? allConversationsResult
      : [];

  const teamMembers =
    Array.isArray(
      teamMembersResult,
    )
      ? teamMembersResult
      : [];

  const requestedMessages =
    Array.isArray(
      requestedMessagesResult,
    )
      ? requestedMessagesResult
      : null;

  const requestedStatus =
    getSingleSearchParam(
      params.status,
    );

  const activeStatus:
    | ConversationStatus
    | "all" =
    requestedStatus &&
    validStatuses.has(
      requestedStatus as
        ConversationStatus,
    )
      ? (
          requestedStatus as
            ConversationStatus
        )
      : "all";

  const filteredConversations =
    activeStatus === "all"
      ? allConversations
      : allConversations.filter(
          (
            conversation,
          ) =>
            conversation.status ===
            activeStatus,
        );

  /*
   * Find the URL-requested conversation from the complete list.
   * The preloaded requestedMessages are only rendered when this
   * conversation belongs to the authenticated business list.
   */
  const requestedConversation =
    requestedConversationId
      ? allConversations.find(
          (
            conversation,
          ) =>
            conversation.id ===
            requestedConversationId,
        ) ?? null
      : null;

  /*
   * If a status filter hides the requested conversation,
   * include it temporarily so the active chat is stable.
   */
  const visibleConversations =
    requestedConversation &&
    !filteredConversations.some(
      (
        conversation,
      ) =>
        conversation.id ===
        requestedConversation.id,
    )
      ? [
          requestedConversation,
          ...filteredConversations,
        ]
      : filteredConversations;

  const activeConversationId =
    requestedConversation?.id ??
    visibleConversations[0]
      ?.id ??
    null;

  const messages =
    requestedConversation
      ? (
          requestedMessages ??
          []
        )
      : activeConversationId
        ? await getMessages(
            activeConversationId,
          )
        : [];

  const statusCounts = {
    all:
      allConversations.length,

    open:
      allConversations.filter(
        (
          conversation,
        ) =>
          conversation.status ===
          "open",
      ).length,

    pending:
      allConversations.filter(
        (
          conversation,
        ) =>
          conversation.status ===
          "pending",
      ).length,

    resolved:
      allConversations.filter(
        (
          conversation,
        ) =>
          conversation.status ===
          "resolved",
      ).length,

    closed:
      allConversations.filter(
        (
          conversation,
        ) =>
          conversation.status ===
          "closed",
      ).length,

    spam:
      allConversations.filter(
        (
          conversation,
        ) =>
          conversation.status ===
          "spam",
      ).length,
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <InboxView
          conversations={
            visibleConversations
          }
          activeConversationId={
            activeConversationId
          }
          messages={
            messages
          }
          activeStatus={
            activeStatus
          }
          statusCounts={
            statusCounts
          }
          teamMembers={
            teamMembers
          }
        />
      </div>
    </div>
  );
}
