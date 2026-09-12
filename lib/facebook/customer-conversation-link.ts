import "server-only";

import { getFacebookPageAccessToken } from "@/lib/facebook/get-facebook-page-access-token";

type Party = { id?: unknown; name?: unknown };
type Thread = { id?: unknown; link?: unknown; participants?: { data?: Party[]; paging?: { next?: unknown } } };

/** Accept a conversation URL returned by Meta; never manufacture one from a PSID.
 * `selected_item_id` is an inbox identifier, not a public-profile guarantee. */
export function normalizeFacebookConversationLink(value: unknown, pageId: string): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value, "https://www.facebook.com");
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["www.facebook.com", "facebook.com", "business.facebook.com"].includes(url.hostname)) return null;
    const pageKeys = ["asset_id", "page_id", "mailbox_id"];
    for (const key of pageKeys) {
      const values = url.searchParams.getAll(key);
      if (values.length > 1 || values.some(id => id !== pageId)) return null;
    }
    const threadKeys = ["selected_item_id", "thread_id", "threadid", "tid"];
    for (const key of threadKeys) {
      const values = url.searchParams.getAll(key);
      if (values.length > 1 || values.some(id => !/^[A-Za-z0-9_.:-]{1,200}$/.test(id))) return null;
    }
    const selected = ["selected_item_id", "thread_id"].flatMap(key => url.searchParams.getAll(key));
    if (new Set(selected).size > 1 || selected.some(id => !/^\d{1,32}$/.test(id))) return null;
    if (url.searchParams.getAll("thread_type").some(type => type !== "FB_MESSAGE")) return null;
    const sections = url.searchParams.getAll("section");
    if (sections.length > 1 || sections.some(section => section !== "messages")) return null;
    const hasThread = threadKeys.some(key => /^[A-Za-z0-9_.:-]{1,200}$/.test(url.searchParams.get(key) || ""));
    if (url.hostname === "business.facebook.com") {
      if (!/^\/latest\/inbox(?:\/[^/]+)?\/?$/.test(url.pathname) ||
          !pageKeys.some(key => url.searchParams.get(key) === pageId) || !hasThread) return null;
    } else {
      const segments = url.pathname.split("/").filter(Boolean);
      const pageInbox = segments[0] === pageId && ["inbox", "messages"].includes(segments[1]) && segments.length === 2;
      // Meta also returns /{page}/inbox/{thread}/?section=messages.
      // The path thread is not the PSID or Suite's selected_item_id.
      const pageInboxThread = segments[0] === pageId && segments[1] === "inbox" &&
        segments.length === 3 && /^\d{1,32}$/.test(segments[2]);
      if (pageInboxThread && hasThread) return null;
      const messages = segments[0] === "messages" && (segments.length === 1 ||
        (segments[1] === "t" && segments.length === 3 && /^[A-Za-z0-9_.:-]{1,200}$/.test(segments[2])));
      if (!pageInboxThread && !(pageInbox && hasThread) && !(messages && (hasThread || segments.length === 3))) return null;
      url.hostname = "www.facebook.com";
    }
    const allowed = new Set([...pageKeys, ...threadKeys, "thread_type", "business_id", "section"]);
    for (const key of [...url.searchParams.keys()]) if (!allowed.has(key)) url.searchParams.delete(key);
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

export function selectCustomerConversationLink(payload: unknown, pageId: string, psid: string) {
  if (!payload || typeof payload !== "object") return { reason: "profile_conversation_link_unavailable" } as const;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return { reason: "profile_conversation_link_unavailable" } as const;
  if ((payload as { paging?: { next?: unknown } }).paging?.next) return { reason: "profile_conversation_ambiguous" } as const;
  if (!data.length) return { reason: "profile_conversation_not_found" } as const;
  const matching: Array<{ conversationLink: string; graphConversationId: string; customerName: string }> = [];
  let participantsMatched = false, unsupportedLink = false, missingLink = false;
  for (const thread of data as Thread[]) {
    if (!thread || typeof thread.id !== "string" || !thread.id || thread.id.length > 200) continue;
    const parties = thread.participants?.data;
    if (!Array.isArray(parties) || thread.participants?.paging?.next) continue;
    const ids = new Set(parties.map(party => party?.id));
    // Both participants must match the authorized Page/customer. Never match by name.
    if (ids.size !== 2 || !ids.has(pageId) || !ids.has(psid)) continue;
    participantsMatched = true;
    const customer = parties.find(party => party?.id === psid);
    const name = typeof customer?.name === "string" ? customer.name.trim() : "";
    const link = normalizeFacebookConversationLink(thread.link, pageId);
    if (typeof thread.link !== "string" || !thread.link.trim()) missingLink = true;
    else if (!link) unsupportedLink = true;
    if (link && name) matching.push({ conversationLink: link, graphConversationId: thread.id, customerName: name });
  }
  if (matching.length > 1) return { reason: "profile_conversation_ambiguous" } as const;
  if (!matching.length) {
    if (!participantsMatched) return { reason: "profile_conversation_participants_unmatched" } as const;
    if (unsupportedLink) return { reason: "profile_conversation_link_unsupported" } as const;
    if (missingLink) return { reason: "profile_conversation_link_missing" } as const;
    return { reason: "profile_conversation_name_unavailable" } as const;
  }
  return { ...matching[0], linkSource: "meta_conversations_api" as const };
}

/** The Page token stays on the server. Only the verified, sanitized link is returned. */
export async function getCustomerConversationLink(pageId: string, psid: string) {
  if (![pageId, psid].every(id => /^\d{1,32}$/.test(id)) || pageId === psid) {
    return { reason: "profile_context_incomplete" } as const;
  }
  try {
    const token = await getFacebookPageAccessToken(pageId);
    const version = process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";
    const url = new URL(`https://graph.facebook.com/${version}/${pageId}/conversations`);
    url.searchParams.set("user_id", psid);
    url.searchParams.set("fields", "id,link,participants");
    url.searchParams.set("limit", "5");
    const response = await fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
      return { reason: [10, 102, 190, 200].includes(payload?.error?.code)
        ? "profile_conversation_access_unavailable" : "profile_conversation_request_failed" } as const;
    }
    return selectCustomerConversationLink(payload, pageId, psid);
  } catch { return { reason: "profile_conversation_lookup_failed" } as const; }
}
