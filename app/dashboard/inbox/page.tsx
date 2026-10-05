import { getConversationPage, ConversationPagingUnavailable } from "@/lib/inbox/get-conversation-page";
import { parseConversationPageRequest } from "@/lib/inbox/conversation-page-contract";
import { InboxView } from "@/components/inbox/inbox-view";
import {
  getConversations,
  getInboxConversationScope,
  preloadInboxConversationChannels,
} from "@/lib/inbox/get-conversations";
import { uuidPattern } from "@/lib/inbox/live-sync";
import { getMessages } from "@/lib/inbox/get-messages";
import { getTeamMembers } from "@/lib/inbox/get-team-members";

import type {
  ConversationStatus,
  InboxConversation,
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
  const requestedConversationId = getSingleSearchParam(params.conversation);
  // First-page hydration uses the full accessible scope; an off-page lookup
  // may narrow it to one workspace. Wait for paging when those keys differ.
  const narrowsHydrationScope = pageRequest.workspaceId !== null &&
    inboxScope.accessibleBusinessIds.some(id => id !== pageRequest.workspaceId);
  if (requestedConversationId && uuidPattern.test(requestedConversationId) && !narrowsHydrationScope) {
    // A saved thread needs enabled-channel metadata either on the first page
    // or for off-page authorization. Overlap it with paging, without loading
    // conversations/messages early. Hydration consumes the same cached read;
    // observe rejection now, then let its normal consumer report the error.
    void preloadInboxConversationChannels().catch(() => {});
  }
  async function loadInboxData() {
    const selectedMessageRead: { current: Promise<{ messages: Awaited<ReturnType<typeof getMessages>> } | { error: unknown }> | null } = { current: null };
    const startSelectedMessages = (rows: InboxConversation[]) => {
      if (selectedMessageRead.current || !requestedConversationId || !rows.some(row => row.id === requestedConversationId)) return;
      // Only the freshly authorized row starts this read. Observe failures
      // immediately and report them after all required hydration succeeds.
      selectedMessageRead.current = getMessages(requestedConversationId).then(messages => ({ messages }), error => ({ error }));
    };
    let initialPage;
    try { initialPage = await getConversationPage(pageRequest, false, startSelectedMessages); }
    catch (error) {
      // Only an absent read RPC permits the complete legacy dataset fallback.
      if (!(error instanceof ConversationPagingUnavailable)) throw error;
    }
    const channelConversations = initialPage ? [...initialPage.conversations] : await getConversations(
      inboxScope.accessibleBusinessIds, { channelId: selectedChannelId, workspaceId: selectedWorkspaceId, onAuthorizedRows: startSelectedMessages },
    );

    // Authorize an off-page selection before reading its messages, and keep
    // it out of the page cursor. Assignment-team data is independent of this.
    let requestedConversation = requestedConversationId
      ? channelConversations.find(row => row.id === requestedConversationId) ?? null : null;
    if (initialPage && requestedConversationId && !requestedConversation) {
      const selected = await getConversations(inboxScope.accessibleBusinessIds, {
        conversationIds: [requestedConversationId], channelId: selectedChannelId, workspaceId: selectedWorkspaceId, onAuthorizedRows: startSelectedMessages,
      });
      requestedConversation = selected[0] ?? null;
      if (requestedConversation) channelConversations.push(requestedConversation);
    }
    const activeConversationId = requestedConversation?.id ?? null;
    let messages: Awaited<ReturnType<typeof getMessages>> = [];
    if (activeConversationId) {
      if (selectedMessageRead.current) {
        const result = await selectedMessageRead.current;
        if ("error" in result) throw result.error;
        messages = result.messages;
      } else messages = await getMessages(activeConversationId);
    }
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
