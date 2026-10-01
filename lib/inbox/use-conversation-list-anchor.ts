"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

type Anchor = { key: string; offset: number };
const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-conversation-list-id]")];
export function captureConversationListAnchor(container: HTMLElement): Anchor | null {
  if (container.scrollTop <= 0) return null;
  const top = container.getBoundingClientRect().top;
  const row = rows(container).find(row => row.getBoundingClientRect().bottom > top);
  return row ? { key: row.dataset.conversationListId!, offset: row.getBoundingClientRect().top - top } : null;
}
export function restoreConversationListAnchor(container: HTMLElement, anchor: Anchor | null) {
  if (!anchor) return;
  const row = rows(container).find(row => row.dataset.conversationListId === anchor.key);
  if (row) container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.offset;
}

/** Activity can reorder rows without moving the reader's visible anchor.
 * View changes start a new anchor; message-pane scrolling is independent. */
export function useConversationListAnchor(containerRef: RefObject<HTMLDivElement | null>, scope: string, rowKey: string) {
  const anchorRef = useRef<{ scope: string; anchor: Anchor | null } | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (anchorRef.current?.scope === scope) restoreConversationListAnchor(container, anchorRef.current.anchor);
    const capture = () => { anchorRef.current = { scope, anchor: captureConversationListAnchor(container) }; };
    capture();
    container.addEventListener("scroll", capture, { passive: true });
    return () => container.removeEventListener("scroll", capture);
  }, [containerRef, scope, rowKey]);
}
