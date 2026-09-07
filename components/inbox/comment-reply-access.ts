type CommentRow = {
  id: string;
  platform_message_id: string;
  comment_is_hidden?: boolean | null;
  comment_is_deleted?: boolean | null;
  raw_payload?: unknown;
};

export function isCommentReplyBlocked(
  commentId: string,
  messages: CommentRow[],
  optimistic: Record<string, { hidden: boolean; deleted: boolean }> = {},
): boolean {
  const visited = new Set<string>();
  let id: string | undefined = commentId;
  while (id && !visited.has(id)) {
    visited.add(id);
    const row = messages.find((item) => item.platform_message_id === id);
    if (!row) return false;
    const state = optimistic[row.id];
    if ((state?.hidden ?? row.comment_is_hidden) || (state?.deleted ?? row.comment_is_deleted)) return true;
    const raw = row.raw_payload as { parent_id?: string; parent_comment_id?: string; parent?: { id?: string } } | null;
    id = raw?.parent_id ?? raw?.parent_comment_id ?? raw?.parent?.id;
  }
  return false;
}
