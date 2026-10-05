export type InboxSearchMatch = { messageId: string; text: string; sentAt: string | null };

/** Keep the part that matched visible, even in a long historical message. */
export function searchSnippet(text: string, query: string) {
  const at = text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase());
  const start = Math.max(0, at - 45);
  const end = Math.min(text.length, Math.max(start + 180, at + query.trim().length));
  return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function searchRowSubtitle(query: string, match: InboxSearchMatch | undefined, phone: string | null | undefined, preview: string | null) {
  if (match) return searchSnippet(match.text, query);
  if (query.trim() && phone?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) return phone;
  return preview;
}
