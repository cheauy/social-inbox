type EchoMessage = {
  id: string;
  conversation_id: string;
  direction: string;
  raw_payload: unknown;
};

// Match only our exact send id within the same conversation. Never deduplicate
// by photo appearance or timestamps: agents may intentionally resend a photo.
export function withoutEchoedAttachmentDrafts<T extends EchoMessage>(messages: T[]): T[] {
  const echoed = new Set<string>();
  for (const message of messages) {
    const raw = message.raw_payload as { message?: { metadata?: unknown }; tenh_client_request_id?: unknown } | null;
    const metadata = raw?.message?.metadata ?? raw?.tenh_client_request_id;
    if (message.direction === "outgoing" && !message.id.startsWith("optimistic:") &&
        typeof metadata === "string" && metadata.startsWith("optimistic:attachment:")) {
      echoed.add(`${message.conversation_id}:${metadata}`);
    }
  }
  return messages.filter((message) => !echoed.has(`${message.conversation_id}:${message.id}`));
}
