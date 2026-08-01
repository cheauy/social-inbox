import { InboxView } from "@/components/inbox/inbox-view";
import { getConversations } from "@/lib/inbox/get-conversations";
import { getMessages } from "@/lib/inbox/get-messages";

type InboxPageProps = {
  searchParams: Promise<{
    conversation?: string;
  }>;
};

export default async function InboxPage({
  searchParams,
}: InboxPageProps) {
  const params = await searchParams;
  const conversations = await getConversations();

  const requestedConversationId =
    params.conversation ?? null;

  const validRequestedConversation =
    requestedConversationId &&
    conversations.some(
      (conversation) =>
        conversation.id === requestedConversationId,
    );

  const activeConversationId =
    validRequestedConversation
      ? requestedConversationId
      : conversations[0]?.id ?? null;

  const messages = activeConversationId
    ? await getMessages(activeConversationId)
    : [];

  return (
    <main className="p-6">
      <div className="mx-auto max-w-6xl">
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
          activeConversationId={
            activeConversationId
          }
          messages={messages}
        />
      </div>
    </main>
  );
}