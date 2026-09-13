import type { FacebookMessagingEvent } from "@/types/facebook";

type MessageContent = {
  messageType:
    | "text"
    | "image"
    | "video"
    | "audio"
    | "file"
    | "sticker"
    | "unknown";

  messageText: string | null;
  attachmentUrl: string | null;
};

export function getFacebookMessageContent(
  event: FacebookMessagingEvent,
): MessageContent {
  const message = event.message;

  if (!message) {
    return {
      messageType: "unknown",
      messageText: null,
      attachmentUrl: null,
    };
  }

  if (message.text) {
    return {
      messageType: "text",
      messageText: message.text,
      attachmentUrl: null,
    };
  }

  // During Meta's transition a sticker may also include an image attachment.
  const attachment = message.attachments?.find(item => item.type === "sticker" || item.payload?.sticker_id != null)
    ?? message.attachments?.[0];

  if (!attachment) {
    return {
      messageType: "unknown",
      messageText: "[Unsupported message]",
      attachmentUrl: null,
    };
  }

  if (
    attachment.type === "sticker" ||
    (attachment.type === "image" && attachment.payload?.sticker_id != null)
  ) {
    return {
      messageType: "sticker",
      messageText: "[Sticker]",
      attachmentUrl: attachment.payload?.url ?? null,
    };
  }

  if (
    attachment.type === "image" ||
    attachment.type === "video" ||
    attachment.type === "audio" ||
    attachment.type === "file"
  ) {
    return {
      messageType: attachment.type,
      messageText: `[${attachment.type}]`,
      attachmentUrl: attachment.payload?.url ?? null,
    };
  }

  return {
    messageType: "unknown",
    messageText: "[Unsupported message]",
    attachmentUrl: attachment.payload?.url ?? null,
  };
}
