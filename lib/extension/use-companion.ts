"use client";

import { useCallback, useEffect, useState } from "react";
import { awaitCompanionAnswer } from "./companion-response";

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

export type FacebookProfileOpenResult = {
  opened: boolean;
  resolved?: boolean;
  pageId?: string;
  threadId?: string;
  conversationId?: string;
  businessId?: string;
  verified?: boolean;
  profileId?: string | null;
  profileUrl?: string | null;
  openToken?: string;
  conversationOpened?: boolean;
  reason?: string;
};

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

export function useCompanion() {
  const [installed, setInstalled] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    const detect = () => { post("TENH_EXTENSION_PING"); };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== "TENH_EXTENSION") return;
      if (!["TENH_EXTENSION_PONG", "TENH_EXTENSION_READY"].includes(data.type)) return;
      // Invalidated scripts can still answer after a reload. Only live replies count.
      if (data.error || data.requiresRefresh || typeof data.version !== "string") return;
      setInstalled(true);
      setVersion(data.version);
    };
    window.addEventListener("message", receive);
    window.addEventListener("focus", detect);
    const timer = window.setInterval(detect, 15000);
    detect();
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener("focus", detect);
      window.clearInterval(timer);
    };
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

      const answer = await awaitCompanionAnswer<{ opened?: boolean }>(
        "OPEN_IN_FACEBOOK_RESULT",
        requestId,
        10000,
      );

      return answer?.opened === true;
    },
    [],
  );

  /**
   * Open the real Facebook profile link that Facebook itself exposes for the
   * customer in the exact Page conversation. Never derives a profile URL from
   * TENH's Messenger/PSID customer id -- those ids are Page-scoped and are not
   * public Facebook profile ids.
   */
  const openFacebookProfile = useCallback(
    async (options: {
      pageId?: string | null;
      threadId?: string | null;
      conversationId?: string | null;
      customerName?: string | null;
      businessId?: string | null;
    }): Promise<FacebookProfileOpenResult | null> => {
      const requestId = post("OPEN_FACEBOOK_PROFILE", {
        pageId: options.pageId ?? undefined,
        threadId: options.threadId ?? undefined,
        conversationId: options.conversationId ?? undefined,
        customerName: options.customerName ?? undefined,
        businessId: options.businessId ?? undefined,
      });

      return awaitCompanionAnswer<FacebookProfileOpenResult>(
        "OPEN_FACEBOOK_PROFILE_RESULT",
        requestId,
        90000,
      );
    },
    [],
  );

  const openResolvedFacebookProfile = useCallback(async (
    openToken: string,
    context?: { pageId: string; threadId: string; conversationId: string; businessId: string },
  ) => {
    const requestId = post("OPEN_RESOLVED_FACEBOOK_PROFILE", { openToken, ...context });
    return awaitCompanionAnswer<FacebookProfileOpenResult>("OPEN_RESOLVED_FACEBOOK_PROFILE_RESULT", requestId, 15000);
  }, []);

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

      return awaitCompanionAnswer<ReplyAvailability>(
        "CHECK_FACEBOOK_REPLY_AVAILABILITY_RESULT",
        requestId,
        18000,
      );
    },
    [],
  );

  return { installed, version, openInFacebook, openFacebookProfile, openResolvedFacebookProfile, checkReplyAvailability };
}
