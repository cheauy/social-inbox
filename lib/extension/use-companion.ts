"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Asking the browser whether TENH Companion is there, and asking it for things.
 *
 * A page cannot see an extension; it can only speak into its own window and
 * wait. Everything here is written around that: a question that goes
 * unanswered means "not installed", never a spinner, and every caller gets a
 * plain false rather than a promise that never settles.
 *
 * Nothing in the Inbox may depend on this. It exists so a screen can offer one
 * extra button when a companion happens to be installed, and offer nothing at
 * all when it is not.
 */

const ANSWER_TIMEOUT_MS = 1500;

export type ReplyAvailability = {
  facebookConnected: boolean;
  conversationVisible: boolean;
  composerFound: boolean;
  composerEnabled: boolean;
  reason?: string;
};

function post(type: string, payload: Record<string, unknown> = {}) {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  window.postMessage(
    { source: "TENH_WEB", type, requestId, ...payload },
    window.location.origin,
  );

  return requestId;
}

function awaitAnswer<T>(
  type: string,
  requestId: string,
  timeout = ANSWER_TIMEOUT_MS,
): Promise<T | null> {
  return new Promise((resolve) => {
    const done = (value: T | null) => {
      window.removeEventListener("message", listener);
      window.clearTimeout(timer);
      resolve(value);
    };

    const listener = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }

      const data = event.data;

      if (!data || typeof data !== "object") return;
      if (data.source !== "TENH_EXTENSION") return;
      if (data.type !== type) return;
      if (data.requestId && data.requestId !== requestId) return;

      done(data as T);
    };

    window.addEventListener("message", listener);

    const timer = window.setTimeout(() => done(null), timeout);
  });
}

export function useCompanion() {
  const [installed, setInstalled] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;

    asked.current = true;

    const requestId = post("TENH_EXTENSION_PING");

    void awaitAnswer<{ version?: string }>(
      "TENH_EXTENSION_PONG",
      requestId,
    ).then((answer) => {
      if (!answer) return;

      setInstalled(true);
      setVersion(answer.version ?? null);
    });
  }, []);

  /**
   * Bring the Facebook tab for this Page forward, or open one.
   *
   * `threadId` is the customer's page-scoped id -- the one Business Suite puts
   * in its own URL -- so this can land on the actual conversation rather than
   * the top of the inbox. TENH's conversation id means nothing to Facebook.
   */
  const openInFacebook = useCallback(
    async (options: {
      pageId?: string | null;
      threadId?: string | null;
      conversationId?: string | null;
    }) => {
      const requestId = post("OPEN_IN_FACEBOOK", {
        pageId: options.pageId ?? undefined,
        threadId: options.threadId ?? undefined,
        conversationId: options.conversationId ?? undefined,
      });

      const answer = await awaitAnswer<{ opened?: boolean }>(
        "OPEN_IN_FACEBOOK_RESULT",
        requestId,
      );

      return answer?.opened === true;
    },
    [],
  );

  /**
   * What Facebook's own interface is showing for this conversation.
   *
   * An answer of "the composer is enabled" is a report about a browser tab, not
   * a permission and not a promise: TENH still sends through the Messenger API
   * first, and where Meta refuses, a person decides what to do in Facebook
   * itself.
   */
  const checkReplyAvailability = useCallback(
    async (options: {
      conversationId: string;
      pageId?: string | null;
      threadId?: string | null;
    }) => {
      const requestId = post("CHECK_FACEBOOK_REPLY_AVAILABILITY", {
        conversationId: options.conversationId,
        pageId: options.pageId ?? undefined,
        threadId: options.threadId ?? undefined,
      });

      return awaitAnswer<ReplyAvailability>(
        "CHECK_FACEBOOK_REPLY_AVAILABILITY_RESULT",
        requestId,
        18000,
      );
    },
    [],
  );

  /**
   * Open this customer's Facebook profile, through Facebook itself.
   *
   * A Messenger customer is known to TENH only by their page-scoped id, and
   * that id is not a Facebook account: profile.php?id=<psid> lands on "This
   * content isn't available" for every customer, because Meta issues a
   * different id per Page precisely so a business cannot look a person up.
   * The extension asks Business Suite for its own "View profile" link instead,
   * and focuses the conversation when Facebook offers none.
   *
   * The wait is long on purpose: preparing a Facebook tab can take seconds,
   * and giving up early would open a second tab beside the one the extension
   * is still preparing. Null means no answer at all, not "no profile".
   */
  const openFacebookProfile = useCallback(
    async (options: {
      pageId?: string | null;
      threadId?: string | null;
      conversationId?: string | null;
      customerName?: string | null;
    }) => {
      const requestId = post("OPEN_FACEBOOK_PROFILE", {
        pageId: options.pageId ?? undefined,
        threadId: options.threadId ?? undefined,
        conversationId: options.conversationId ?? undefined,
        customerName: options.customerName ?? undefined,
      });

      return awaitAnswer<{
        opened?: boolean;
        profileUrl?: string | null;
        conversationOpened?: boolean;
        reason?: string | null;
      }>("OPEN_FACEBOOK_PROFILE_RESULT", requestId, 25000);
    },
    [],
  );

  return {
    installed,
    version,
    openInFacebook,
    openFacebookProfile,
    checkReplyAvailability,
  };
}
