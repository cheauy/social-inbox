export function facebookMediaMessage(kind: string, attachmentIds: string[]) {
  if (attachmentIds.length < 1 || attachmentIds.length > 30) {
    throw new Error("Select between 1 and 30 attachments.");
  }
  if (attachmentIds.length > 1 && kind !== "image") {
    throw new Error("Only photos can be sent together in Messenger.");
  }
  const attachments = attachmentIds.map((attachment_id) => ({
    type: kind,
    payload: { attachment_id },
  }));
  return attachments.length > 1
    ? { attachments }
    : { attachment: attachments[0] };
}
