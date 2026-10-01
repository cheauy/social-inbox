export const VERIFIED_CONVERSATION_MIN_VERSION = "1.2.33";
export type ConversationContext = { businessId: string; conversationId: string; pageId: string; threadId: string };

export function supportsVerifiedConversation(value: unknown, origin: string): boolean {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  if (data.type !== "TENH_EXTENSION_PONG" || data.error || data.requiresRefresh || data.connected !== true ||
      data.verifiedConversationNavigation !== true || data.appOrigin !== origin || typeof data.version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(data.version)) return false;
  const actual = data.version.split(".").map(Number), minimum = VERIFIED_CONVERSATION_MIN_VERSION.split(".").map(Number);
  for (let i = 0; i < minimum.length; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
}

export function matchesConversationContext(value: unknown, expected: ConversationContext): boolean {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return Object.entries(expected).every(([key, id]) => data[key] === id);
}

export function verifiedConversationOpened(value: unknown, expected: ConversationContext): boolean {
  const data = value as Record<string, unknown> | null;
  return Boolean(data && data.opened === true && data.exactRequested === true && data.verified === true && matchesConversationContext(data, expected));
}
