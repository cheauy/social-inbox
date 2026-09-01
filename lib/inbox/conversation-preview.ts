export type ConversationPreviewDirection =
  | "incoming"
  | "outgoing"
  | null
  | undefined;

export type ConversationPreviewMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "file"
  | "document"
  | "sticker"
  | "unknown"
  | null
  | undefined;

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "";
}

export function isStandaloneLinkMessage(
  value: unknown,
) {
  const text = cleanText(value);

  if (!text || /\s/.test(text)) {
    return false;
  }

  return /^(?:https?:\/\/|www\.)\S+$/i.test(text);
}

function directionText({
  direction,
  incoming,
  outgoing,
  fallback,
}: {
  direction: ConversationPreviewDirection;
  incoming: string;
  outgoing: string;
  fallback: string;
}) {
  if (direction === "incoming") {
    return incoming;
  }

  if (direction === "outgoing") {
    return outgoing;
  }

  return fallback;
}

export function getConversationMessagePreview({
  direction,
  messageType,
  messageText,
}: {
  direction: ConversationPreviewDirection;
  messageType: ConversationPreviewMessageType;
  messageText: unknown;
}) {
  const type =
    typeof messageType === "string"
      ? messageType
      : "unknown";
  const text = cleanText(messageText);

  if (type === "image") {
    return directionText({
      direction,
      incoming: "You receive an image",
      outgoing: "You sent an image",
      fallback: text || "Image",
    });
  }

  if (type === "audio" || type === "voice") {
    return directionText({
      direction,
      incoming: "You receive a voice message",
      outgoing: "You sent a voice message",
      fallback: text || "Voice message",
    });
  }

  if (type === "video") {
    return directionText({
      direction,
      incoming: "You receive a video",
      outgoing: "You sent a video",
      fallback: text || "Video",
    });
  }

  if (type === "file" || type === "document") {
    return directionText({
      direction,
      incoming: "You receive a file",
      outgoing: "You sent a file",
      fallback: text || "File",
    });
  }

  if (type === "text" && isStandaloneLinkMessage(text)) {
    return directionText({
      direction,
      incoming: "You receive a link",
      outgoing: "You sent a link",
      fallback: text,
    });
  }

  return text || "New message";
}

/*
 * Older Facebook Messenger attachment rows stored placeholders such as
 * "[audio]" directly in conversations.last_message_text. These values were
 * created only by incoming webhook attachment parsing, so normalize them at
 * render time without changing historical message rows or running a migration.
 */
export function normalizeLegacyConversationPreview(
  value: string | null | undefined,
) {
  const text = cleanText(value);

  switch (text.toLowerCase()) {
    case "[image]":
      return "You receive an image";
    case "[audio]":
      return "You receive a voice message";
    case "[video]":
      return "You receive a video";
    case "[file]":
      return "You receive a file";
    default:
      return text || "No messages";
  }
}
