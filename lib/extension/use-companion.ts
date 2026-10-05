"use client";

import { useCallback, useEffect, useState } from "react";
import { awaitCompanionAnswer } from "./companion-response";
import { matchesConversationContext, supportsVerifiedConversation, verifiedConversationOpened, type ConversationContext } from "./verified-conversation";
import { readNavigationFailure } from "./conversation-navigation-failure";

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
  lookupDetails?: {
    expectedName: string;
    headingRegions: number | null;
    cardRegions: number | null;
    profileActions: number | null;
    linkActions: number | null;
  };
};

export type ReplyAvailability = {
  facebookConnected: boolean;
  conversationVisible: boolean;
  composerFound: boolean;
  composerEnabled: boolean;
  reason?: string;
};

export type FacebookConversationOpenResult = {
  prepared?: boolean;
  openToken?: string;
  businessId?: string;
  conversationId?: string;
  pageId?: string;
  threadId?: string;
  extensionVersion?: string;
  phase?: string;
  verificationReason?: string;
  focusReturned?: boolean;
  temporaryTabClosed?: boolean;
  opened?: boolean;
  exactRequested?: boolean;
  verified?: boolean;
  diagnostics?: {
    extensionVersion?: string; pageId?: string; recipientId?: string; conversationId?: string;
    expectedCustomerName?: string; reason?: string; observedNavigationId?: string | null;
    phase?: string; cacheUsed?: boolean; dom?: Record<string, unknown>;
  };
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
  const [verifiedConversationNavigation, setVerifiedConversationNavigation] = useState(false);
  useEffect(() => {
    let ping: string | null = null, expiry: number | undefined;
    const detect = () => {
      window.clearTimeout(expiry);
      ping = post("TENH_EXTENSION_PING");
      expiry = window.setTimeout(() => setVerifiedConversationNavigation(false), 3000);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== "TENH_EXTENSION") return;
      if (data.type === "TENH_EXTENSION_CONTEXT_INVALIDATED" || data.requiresRefresh || data.error === "extension_unavailable") {
        setInstalled(false); setVersion(null); setVerifiedConversationNavigation(false); return;
      }
      if (!["TENH_EXTENSION_PONG", "TENH_EXTENSION_READY"].includes(data.type)) return;
      // Invalidated scripts can still answer after a reload. Only live replies count.
      if (data.error || data.requiresRefresh || typeof data.version !== "string") return;
      setInstalled(true);
      setVersion(data.version);
      if (data.type === "TENH_EXTENSION_PONG" && data.requestId === ping) {
        window.clearTimeout(expiry);
        setVerifiedConversationNavigation(supportsVerifiedConversation(data, window.location.origin));
      }
    };
    window.addEventListener("message", receive);
    window.addEventListener("focus", detect);
    const timer = window.setInterval(detect, 15000);
    detect();
    return () => {
      window.removeEventListener("message", receive);
      window.removeEventListener("focus", detect);
      window.clearInterval(timer);
      window.clearTimeout(expiry);
    };
  }, []);

  /**
   * Bring the Facebook tab for this Page forward, or open one.
   *
   * `threadId` is the customer's Page-scoped Messenger id (PSID). The
   * Companion asks TENH for Meta's exact provider conversation link and, when
   * available, resolves the separate Business Suite selected_item_id/global
   * navigation id. TENH's local conversation UUID is never sent to Facebook.
   */
  const openInFacebook = useCallback(
    async (options: {
      pageId?: string | null;
      threadId?: string | null;
      conversationId?: string | null;
      businessId?: string | null;
    }) => {
      const requestId = post("OPEN_IN_FACEBOOK", {
        businessId: options.businessId ?? undefined,
        pageId: options.pageId ?? undefined,
        threadId: options.threadId ?? undefined,
        conversationId: options.conversationId ?? undefined,
      });

      const answer = await awaitCompanionAnswer<FacebookConversationOpenResult>(
        "OPEN_IN_FACEBOOK_RESULT",
        requestId,
        30000,
      );

      return answer;
    },
    [],
  );

  const openVerifiedConversation = useCallback(async (context: ConversationContext, signal: AbortSignal, isCurrent: () => boolean) => {
    if (!verifiedConversationNavigation || signal.aborted || !isCurrent()) return null;
    const navigationRequestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cancel = () => { post("CANCEL_FACEBOOK_CONVERSATION", { navigationRequestId }); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const preparedId = post("PREPARE_FACEBOOK_CONVERSATION", { ...context, navigationRequestId });
      const prepared = await awaitCompanionAnswer<FacebookConversationOpenResult>("PREPARE_FACEBOOK_CONVERSATION_RESULT", preparedId, 30000, window, signal);
      if (signal.aborted || !isCurrent()) return null;
      if (!prepared) return readNavigationFailure(null, "prepare", "extension_response_unavailable");
      if (prepared.prepared !== true || prepared.verified !== true) return readNavigationFailure(prepared, "prepare");
      if (prepared.opened !== false || prepared.exactRequested !== true || !matchesConversationContext(prepared, context) ||
          typeof prepared.openToken !== "string" || !/^[a-f0-9-]{36}$/.test(prepared.openToken)) {
        return readNavigationFailure({ reason: "conversation_context_mismatch", opened: prepared.opened === true }, "prepare");
      }
      const commitId = post("COMMIT_FACEBOOK_CONVERSATION", { ...context, navigationRequestId, openToken: prepared.openToken });
      const committed = await awaitCompanionAnswer<FacebookConversationOpenResult>("COMMIT_FACEBOOK_CONVERSATION_RESULT", commitId, 15000, window, signal);
      if (signal.aborted || !isCurrent()) return null;
      if (!committed) return readNavigationFailure(null, "commit", "extension_response_unavailable");
      if (verifiedConversationOpened(committed, context)) return committed;
      if (committed.verified === true || committed.exactRequested === true) return readNavigationFailure({
        reason: "conversation_context_mismatch", opened: committed.opened === true, phase: committed.phase }, "commit");
      return readNavigationFailure(committed, "commit");
    } finally {
      signal.removeEventListener("abort", cancel);
      cancel();
    }
  }, [verifiedConversationNavigation]);

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

  return { installed, version, verifiedConversationNavigation, openVerifiedConversation, openInFacebook, openFacebookProfile, openResolvedFacebookProfile, checkReplyAvailability };
}
