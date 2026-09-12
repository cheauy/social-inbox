// The webhook can arrive before the send response. Prefer the stored row,
// including its delivery/read receipt, over the temporary sent bubble.
export function confirmOutgoingMessage<T extends {
  id: string;
  conversation_id: string;
  platform_message_id: string | null;
}>(messages: T[], tempId: string, platformId: string): T[] {
  const temporary = messages.find((message) => message.id === tempId);
  if (!temporary) return messages;
  const confirmed = messages.some((message) => message.id !== tempId &&
    message.conversation_id === temporary.conversation_id &&
    message.platform_message_id === platformId);
  return confirmed
    ? messages.filter((message) => message.id !== tempId)
    : messages.map((message) => message.id === tempId
      ? { ...message, platform_message_id: platformId } : message);
}
