import type { ComponentProps, ReactNode } from "react";

export function ConversationHeaderSurface({ children }: { children: ReactNode }) {
  return <div data-conversation-header-surface className="relative z-10 shrink-0 bg-white p-3 shadow-[0_3px_8px_rgba(15,23,42,0.04)]">{children}</div>;
}
export function ConversationRail({ children }: { children: ReactNode }) {
  return <aside data-conversation-rail className="relative z-30 flex h-full w-15 shrink-0 flex-col overflow-visible bg-slate-50 py-3">{children}</aside>;
}
export function MessageViewportFrame({ children }: { children: ReactNode }) {
  return <div data-message-viewport-frame className="relative flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>;
}
export function MessageScrollSurface({ children, ...props }: ComponentProps<"div">) {
  return <div {...props} data-message-scroll-surface className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">{children}</div>;
}
