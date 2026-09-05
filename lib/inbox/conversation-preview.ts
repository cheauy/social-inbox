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
  | "animation"
  | "gif"
  | "location"
  | "contact"
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
      incoming: "Sent you a photo",
      outgoing: "You sent a photo",
      fallback: text || "Photo",
    });
  }

  if (type === "audio" || type === "voice") {
    return directionText({
      direction,
      incoming: "Sent you a voice message",
      outgoing: "You sent a voice message",
      fallback: text || "Voice message",
    });
  }

  if (type === "video") {
    return directionText({
      direction,
      incoming: "Sent you a video",
      outgoing: "You sent a video",
      fallback: text || "Video",
    });
  }

  if (type === "file" || type === "document") {
    return directionText({
      direction,
      incoming: "Sent you a file",
      outgoing: "You sent a file",
      fallback: text || "File",
    });
  }

  /*
   * Sticker, GIF, location and contact had no case here, so a conversation
   * whose newest message was one of them fell through to the raw stored text --
   * usually a placeholder, sometimes nothing at all.
   */
  if (type === "sticker") {
    return directionText({
      direction,
      incoming: "Sent you a sticker",
      outgoing: "You sent a sticker",
      fallback: text || "Sticker",
    });
  }

  if (
    type === "animation" ||
    type === "gif"
  ) {
    return directionText({
      direction,
      incoming: "Sent you a GIF",
      outgoing: "You sent a GIF",
      fallback: text || "GIF",
    });
  }

  if (type === "location") {
    return directionText({
      direction,
      incoming: "Sent you a location",
      outgoing: "You sent a location",
      fallback: text || "Location",
    });
  }

  if (type === "contact") {
    return directionText({
      direction,
      incoming: "Sent you a contact",
      outgoing: "You sent a contact",
      fallback: text || "Contact",
    });
  }

  if (type === "text" && isStandaloneLinkMessage(text)) {
    return directionText({
      direction,
      incoming: "Sent you a link",
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
      return "Sent you a photo";
    case "[audio]":
      return "Sent you a voice message";
    case "[video]":
      return "Sent you a video";
    case "[file]":
      return "Sent you a file";

    /*
     * Rows written before the wording changed still hold the old sentence in
     * conversations.last_message_text. The list shows the stored value first
     * and the derived one a moment later, so leaving these unmapped made the
     * preview visibly flip between the two whenever a conversation was opened.
     */
    case "you receive an image":
      return "Sent you a photo";
    case "you receive a voice message":
      return "Sent you a voice message";
    case "you receive a video":
      return "Sent you a video";
    case "you receive a file":
      return "Sent you a file";
    case "you receive a link":
      return "Sent you a link";
    case "you sent an image":
      return "You sent a photo";

    default:
      return text || "No messages";
  }
}
