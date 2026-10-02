type StableRenderMessage = {
  id: string;
  __render_key?: string;
  platform_created_at?: string | null;
};

/** Keep React identity stable while the temporary row becomes the stored row. */
export function messageRenderKey(message: StableRenderMessage) {
  return message.__render_key ?? message.id;
}

export function withOptimisticRenderKey<T extends { id: string }>(server: T, optimistic: StableRenderMessage): T {
  return {
    ...server,
    ...(messageRenderKey(optimistic).startsWith("optimistic:") && optimistic.platform_created_at
      ? { platform_created_at: optimistic.platform_created_at }
      : {}),
    __render_key: messageRenderKey(optimistic),
  };
}

// The webhook can arrive before the send response. Prefer the stored row,
// including its delivery/read receipt, but keep the temporary bubble's render
// identity and position so confirmation is only a status change on screen.
export function confirmOutgoingMessage<T extends {
  id: string;
  conversation_id: string;
  platform_message_id: string | null;
}>(messages: T[], tempId: string, platformId: string): T[] {
  const temporary = messages.find((message) => message.id === tempId);
  if (!temporary) return messages;
  const confirmed = messages.find((message) => message.id !== tempId &&
    message.conversation_id === temporary.conversation_id &&
    message.platform_message_id === platformId);
  return confirmed
    ? messages.flatMap((message) => message.id === tempId
      ? [withOptimisticRenderKey({ ...temporary, ...confirmed }, temporary) as T]
      : message.id === confirmed.id ? [] : [message])
    : messages.map((message) => message.id === tempId
      ? { ...message, platform_message_id: platformId } : message);
}
