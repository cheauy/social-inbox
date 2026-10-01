/** Latest activity wins within each pinned group. Equal activity keeps its
 * prior position so duplicate events do not shuffle rows. Workspace keys keep
 * independent businesses from sharing tie positions.
 */
export function stableConversationOrder<T extends { id: string; business_id: string; is_pinned?: boolean | null; last_message_at?: string | null }>(
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
  const time = (row: T) => { const value = row.last_message_at ? Date.parse(row.last_message_at) : NaN; return Number.isFinite(value) ? value : -Infinity; };
  return ordered.sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned)) ||
    (time(a) === time(b) ? 0 : time(a) > time(b) ? -1 : 1));
}
