import { getConversationPage, ConversationPagingUnavailable } from "@/lib/inbox/get-conversation-page";
import { parseConversationPageRequest } from "@/lib/inbox/conversation-page-contract";
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
    view?: string | string[];
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

  const pageRequest = parseConversationPageRequest({
    status: activeStatus, view: getSingleSearchParam(params.view) ?? "all", search: "",
    channelId: selectedChannelId, workspaceId: selectedWorkspaceId && inboxScope.accessibleBusinessIds.includes(selectedWorkspaceId) ? selectedWorkspaceId : null,
    workspaceContextId: selectedWorkspaceId && inboxScope.accessibleBusinessIds.includes(selectedWorkspaceId) ? selectedWorkspaceId : inboxScope.accessibleBusinessIds.includes(inboxScope.currentBusinessId) ? inboxScope.currentBusinessId : null,
  });
  async function loadInboxData() {
    let initialPage;
    try { initialPage = await getConversationPage(pageRequest); }
    catch (error) {
      // Only an absent read RPC permits the complete legacy dataset fallback.
      if (!(error instanceof ConversationPagingUnavailable)) throw error;
    }
    const channelConversations = initialPage ? [...initialPage.conversations] : await getConversations(
      inboxScope.accessibleBusinessIds, { channelId: selectedChannelId, workspaceId: selectedWorkspaceId },
    );

    // Authorize an off-page selection before reading its messages, and keep
    // it out of the page cursor. Assignment-team data is independent of this.
    const requestedConversationId = getSingleSearchParam(params.conversation);
    let requestedConversation = requestedConversationId
      ? channelConversations.find(row => row.id === requestedConversationId) ?? null : null;
    if (initialPage && requestedConversationId && !requestedConversation) {
      const selected = await getConversations(inboxScope.accessibleBusinessIds, {
        conversationIds: [requestedConversationId], channelId: selectedChannelId, workspaceId: selectedWorkspaceId,
      });
      requestedConversation = selected[0] ?? null;
      if (requestedConversation) channelConversations.push(requestedConversation);
    }
    const activeConversationId = requestedConversation?.id ?? null;
    const messages = activeConversationId ? await getMessages(activeConversationId) : [];
    return { initialPage, channelConversations, activeConversationId, messages };
  }

  const [{ initialPage, channelConversations, activeConversationId, messages }, teamMembers] = await Promise.all([
    loadInboxData(), getTeamMembers(inboxScope.accessibleBusinessIds),
  ]);

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
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-50 p-1.5 sm:p-2.5">
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
          statusCounts={initialPage?.counts.statusCounts ?? statusCounts}
          pagination={initialPage ? { request: pageRequest, page: { searchMatches: initialPage.searchMatches, total: initialPage.total, hasMore: initialPage.hasMore, cursor: initialPage.cursor, counts: initialPage.counts, ids: initialPage.conversations.map(row => row.id) } } : undefined}
          teamMembers={teamMembers}
          currentBusinessId={
            inboxScope.currentBusinessId
          }
          currentMemberId={
            inboxScope.currentMemberId
          }
          accessibleBusinessIds={
            inboxScope.accessibleBusinessIds
          }
        />
      </div>
    </div>
  );
}
