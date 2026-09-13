import "server-only";

import { getFacebookPageAccessToken } from "@/lib/facebook/get-facebook-page-access-token";

type Party = { id?: unknown; name?: unknown };
type Thread = { id?: unknown; link?: unknown; participants?: { data?: Party[]; paging?: { next?: unknown } } };

import { getFacebookConversationNavigationId, normalizeFacebookConversationLink } from "@/lib/facebook/conversation-link";
export { getFacebookConversationNavigationId, normalizeFacebookConversationLink } from "@/lib/facebook/conversation-link";

/** Resolve Graph's conversation ID independently of browser-link availability.
 * Preserve the full provider ID, including t_ when present. */
export function selectCustomerConversationThread(payload: unknown, pageId: string, psid: string) {
  if (!payload || typeof payload !== "object") return { reason: "profile_conversation_link_unavailable" } as const;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return { reason: "profile_conversation_link_unavailable" } as const;
  if ((payload as { paging?: { next?: unknown } }).paging?.next) return { reason: "profile_conversation_ambiguous" } as const;
  if (!data.length) return { reason: "profile_conversation_not_found" } as const;
  const matching: Array<{ threadId: string; customerName: string; providerLink: string | null; linkMissing: boolean }> = [];
  for (const thread of data as Thread[]) {
    if (!thread || typeof thread.id !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(thread.id)) continue;
    const parties = thread.participants?.data;
    if (!Array.isArray(parties) || thread.participants?.paging?.next) continue;
    const ids = new Set(parties.map(party => party?.id));
    // Both participants must match the authorized Page/customer. Never match by name.
    if (ids.size !== 2 || !ids.has(pageId) || !ids.has(psid)) continue;
    const customer = parties.find(party => party?.id === psid);
    const name = typeof customer?.name === "string" ? customer.name.trim() : "";
    const link = normalizeFacebookConversationLink(thread.link, pageId);
    matching.push({ threadId: thread.id, customerName: name, providerLink: link,
      linkMissing: typeof thread.link !== "string" || !thread.link.trim() });
  }
  if (matching.length > 1) return { reason: "profile_conversation_ambiguous" } as const;
  if (!matching.length) return { reason: "profile_conversation_participants_unmatched" } as const;
  return { ...matching[0], threadSource: "meta_conversations_api" as const };
}

export function conversationLinkFromThread(thread: ReturnType<typeof selectCustomerConversationThread>, pageId: string, psid: string, { requireCustomerName = true } = {}) {
  if ("reason" in thread) return thread;
  if (!thread.providerLink) return { reason: thread.linkMissing ? "profile_conversation_link_missing" : "profile_conversation_link_unsupported" } as const;
  if (requireCustomerName && !thread.customerName) return { reason: "profile_conversation_name_unavailable" } as const;
  return { conversationLink: thread.providerLink, graphConversationId: thread.threadId, customerName: thread.customerName,
    navigationId: getFacebookConversationNavigationId(thread.providerLink, pageId, psid), linkSource: "meta_conversations_api" as const };
}

export function selectCustomerConversationLink(payload: unknown, pageId: string, psid: string, options: { requireCustomerName?: boolean } = {}) {
  return conversationLinkFromThread(selectCustomerConversationThread(payload, pageId, psid), pageId, psid, options);
}

/** The Page token stays on the server. Return only a participant-matched thread. */
export async function getCustomerConversationThread(pageId: string, psid: string, options: { accessToken?: string } = {}) {
  if (![pageId, psid].every(id => /^\d{1,32}$/.test(id)) || pageId === psid) {
    return { reason: "profile_context_incomplete" } as const;
  }
  try {
    const token = options.accessToken ?? await getFacebookPageAccessToken(pageId);
    const version = process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";
    const url = new URL(`https://graph.facebook.com/${version}/${pageId}/conversations`);
    url.searchParams.set("user_id", psid);
    url.searchParams.set("platform", "MESSENGER");
    url.searchParams.set("fields", "id,link,participants");
    url.searchParams.set("limit", "5");
    const response = await fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
      return { reason: [10, 102, 190, 200].includes(payload?.error?.code)
        ? "profile_conversation_access_unavailable" : "profile_conversation_request_failed" } as const;
    }
    return selectCustomerConversationThread(payload, pageId, psid);
  } catch { return { reason: "profile_conversation_lookup_failed" } as const; }
}

// Preserve the existing contract for extension/public-profile callers.
export async function getCustomerConversationLink(pageId: string, psid: string, options: { accessToken?: string; requireCustomerName?: boolean } = {}) {
  const thread = await getCustomerConversationThread(pageId, psid, options);
  if ("reason" in thread) return thread;
  return conversationLinkFromThread(thread, pageId, psid, options);
}
