/** Preserve the reader's row positions across Realtime, sends and refreshes.
 * New conversations append; explicit pin/unpin still changes the pinned group.
 * Keys include the workspace so switching businesses cannot reuse row positions.
 */
export function stableConversationOrder<T extends { id: string; business_id: string; is_pinned?: boolean | null }>(
  previous: readonly T[], next: readonly T[],
): T[] {
  const key = (row: T) => `${row.business_id}:${row.id}`;
  const remaining = new Map(next.map(row => [key(row), row]));
  const ordered: T[] = [];
  for (const row of previous) {
    const updated = remaining.get(key(row));
    if (updated) { ordered.push(updated); remaining.delete(key(row)); }
  }
  ordered.push(...remaining.values());
  return [
    ...ordered.filter(row => Boolean(row.is_pinned)),
    ...ordered.filter(row => !row.is_pinned),
  ];
}
