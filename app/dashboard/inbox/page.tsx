import { InboxView } from "@/components/inbox/inbox-view";
import { getConversations } from "@/lib/inbox/get-conversations";
import { getMessages } from "@/lib/inbox/get-messages";
import type { ConversationStatus } from "@/types/inbox";
import { getTeamMembers } from "@/lib/inbox/get-team-members";


const validStatuses = new Set<ConversationStatus>([
  "open",
  "pending",
  "resolved",
  "closed",
  "spam",
]);

type InboxPageProps = {
  searchParams: Promise<{
    conversation?: string;
    status?: string;
  }>;
};

export default async function InboxPage({
  searchParams,
}: InboxPageProps) {
  const params = await searchParams;
  const [allConversations, teamMembers] =
  await Promise.all([
    getConversations(),
    getTeamMembers(),
  ]);;

  const requestedStatus = params.status;
  const activeStatus =
    requestedStatus &&
    validStatuses.has(requestedStatus as ConversationStatus)
      ? (requestedStatus as ConversationStatus)
      : "all";

  const conversations =
    activeStatus === "all"
      ? allConversations
      : allConversations.filter(
          (conversation) =>
            conversation.status === activeStatus,
        );

  const requestedConversationId = params.conversation ?? null;

  const validRequestedConversation =
    requestedConversationId &&
    conversations.some(
      (conversation) =>
        conversation.id === requestedConversationId,
    );

  const activeConversationId = validRequestedConversation
    ? requestedConversationId
    : conversations[0]?.id ?? null;

  const messages = activeConversationId
    ? await getMessages(activeConversationId)
    : [];

  const statusCounts = {
    all: allConversations.length,
    open: allConversations.filter(
      (conversation) => conversation.status === "open",
    ).length,
    pending: allConversations.filter(
      (conversation) => conversation.status === "pending",
    ).length,
    resolved: allConversations.filter(
      (conversation) => conversation.status === "resolved",
    ).length,
    closed: allConversations.filter(
      (conversation) => conversation.status === "closed",
    ).length,
    spam: allConversations.filter(
      (conversation) => conversation.status === "spam",
    ).length,
  };

  return (
    <main className="p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">
            Inbox
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Manage Facebook Messenger conversations.
          </p>
        </div>

       <InboxView
  conversations={conversations}
  activeConversationId={activeConversationId}
  messages={messages}
  activeStatus={activeStatus}
  statusCounts={statusCounts}
  teamMembers={teamMembers}
/>
      </div>
    </main>
  );
}
