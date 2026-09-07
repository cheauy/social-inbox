// A refresh may contain the pre-action values until the request finishes.
// Preserve only comments with an in-flight action; others remain live.
export function mergeCommentActionState<T>(
  server: Record<string, T>,
  current: Record<string, T>,
  pending: ReadonlySet<string>,
): Record<string, T> {
  const next = { ...server };
  for (const id of pending) {
    if (id in current) next[id] = current[id];
  }
  return next;
}
