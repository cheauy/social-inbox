export type TelegramOptimisticAttachmentKind =
  | "image"
  | "video"
  | "audio"
  | "file";

export function telegramOptimisticAttachmentKind({
  file,
  requestedKind,
}: {
  file: Pick<File, "name" | "type">;
  requestedKind: TelegramOptimisticAttachmentKind;
}): TelegramOptimisticAttachmentKind {
  if (requestedKind !== "audio") {
    return requestedKind;
  }

  const mime = file.type
    .split(";")[0]
    .trim()
    .toLowerCase();
  const name = file.name.toLowerCase();

  /*
   * This mirrors the TENH message type produced by Telegram send-media:
   * recorder voice, OGG/OPUS voice, MP3 and M4A all render as audio. Other
   * imported audio formats are Telegram documents and must look like files
   * during the optimistic phase too.
   */
  if (
    name.startsWith("voice-message-") ||
    [
      "audio/ogg",
      "audio/opus",
      "audio/mpeg",
      "audio/mp3",
      "audio/mp4",
      "audio/x-m4a",
    ].includes(mime) ||
    /\.(?:ogg|opus|mp3|m4a)$/i.test(name)
  ) {
    return "audio";
  }

  return "file";
}
