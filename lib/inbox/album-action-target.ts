import type { InboxMessage } from "@/types/inbox";
import { parsePhotoReplyId } from "./message-actions";

export type AlbumPhotoSelection = { conversationId: string; photoId: string };

/** Keep UI photo IDs for Copy/Reply and the stored row for Messenger reactions. */
export function getAlbumActionTarget(
  members: InboxMessage[],
  messages: InboxMessage[],
  anchor: InboxMessage,
  active: AlbumPhotoSelection | null,
  replyingTo: string | null,
) {
  const photos = members.filter(photo => photo.conversation_id === anchor.conversation_id);
  const activeId = active?.conversationId === anchor.conversation_id ? active.photoId : null;
  const photo = photos.find(item => item.id === activeId)
    ?? photos.find(item => item.id === replyingTo)
    ?? photos.find(item => item.id === anchor.id)
    ?? photos[0]
    ?? anchor;
  const baseId = parsePhotoReplyId(photo.id).messageId;
  const message = messages.find(item => item.id === baseId && item.conversation_id === anchor.conversation_id) ?? anchor;
  return { photo, message };
}
