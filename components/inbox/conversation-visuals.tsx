// Match the native inbox palette without importing native UI dependencies.
export const CONVERSATION_STATUS_TONE: Record<string, string> = {
  open: "#2FA36B", pending: "#C77700", resolved: "#0089CC",
  closed: "#6D7E91", spam: "#B43232",
};

export function ConversationBookmark({ filled = false }: { filled?: boolean }) {
  return <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
  </svg>;
}

export function ConversationTag({ name, color }: { name: string; color: string }) {
  return <span title={name} className="inline-flex max-w-[150px] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: color, color: "#fff" }}>
    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
    <span className="truncate">{name}</span>
  </span>;
}
