"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

/*
 * Mirror the URL's ?conversation= into the Inbox selection -- for Back/Forward
 * and direct links only.
 *
 * The old effect compared the URL with the current selection on every render
 * and reselected whatever the URL said. After returning to the Inbox at
 * ?conversation=A, clicking B changed the selection but not the URL, so the
 * effect immediately put A back and aborted B's request: the header, the URL
 * and the messages all stuck on A.
 *
 * Two rules fix that without losing navigation:
 *
 * 1. Act only when the URL value changes. A click moves the selection; an
 *    unchanged URL snapshot, however stale, is never a reason to move it back.
 * 2. A URL the Inbox pushed itself is not navigation. useSearchParams can lag
 *    behind pushState, so after clicking B then C the URL may still report B
 *    once C is selected. Own pushes are queued and consumed in order when they
 *    surface, so a late B cannot override C, while Back to B -- a URL no click
 *    is waiting on -- still selects B.
 *
 * A URL naming a conversation the list has not loaded yet is left pending and
 * retried when the list changes, so direct links still open.
 */
export function useUrlConversationSelection({
  requestedConversationId,
  selectedConversationId,
  isAvailable,
  select,
  ownPushesRef,
}: {
  requestedConversationId: string | null;
  selectedConversationId: string | null;
  isAvailable: (conversationId: string) => boolean;
  select: (conversationId: string) => void;
  ownPushesRef: MutableRefObject<string[]>;
}) {
  /* undefined until the first URL value is handled. */
  const lastSeenRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const requested = requestedConversationId;

    if (requested === lastSeenRef.current) return;

    if (requested) {
      const own = ownPushesRef.current.indexOf(requested);

      if (own >= 0) {
        /* Our own click surfacing late; it and anything older are settled. */
        ownPushesRef.current.splice(0, own + 1);
        lastSeenRef.current = requested;
        return;
      }
    }

    if (!requested) {
      /*
       * Bare Inbox, or a filter/channel URL without a conversation. Keep the
       * client-selected thread; a refresh still starts empty.
       */
      lastSeenRef.current = requested;
      return;
    }

    /* Not in the list yet: leave it pending so it applies once it loads. */
    if (!isAvailable(requested)) return;

    lastSeenRef.current = requested;

    if (requested !== selectedConversationId) select(requested);
  }, [requestedConversationId, selectedConversationId, isAvailable, select, ownPushesRef]);
}
