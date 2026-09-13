/** Business Suite uses a conversation/profile navigation id that is often
 * different from the Messenger PSID. Accept it only from a provider-returned
 * conversation link matched to the exact Page/customer, or a link explicitly
 * confirmed for that customer by an authorized workspace member. */
export function getFacebookConversationNavigationId(value: unknown, pageId: string, psid: string): string | null {
  const link = normalizeFacebookConversationLink(value, pageId);
  if (!link) return null;
  try {
    const url = new URL(link);
    const ids = url.searchParams.getAll("selected_item_id");
    if (ids.length !== 1) return null;
    const id = ids[0]?.trim();
    return id && /^\d{1,32}$/.test(id) && id !== pageId && id !== psid ? id : null;
  } catch { return null; }
}

/** A directly selected Suite conversation, never an inferred ID conversion. */
export function normalizeBusinessSuiteConversationLink(value: unknown, pageId: string, psid: string): string | null {
  const normalized = normalizeFacebookConversationLink(value, pageId);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (url.hostname !== "business.facebook.com" || !/^\/latest\/inbox\/(?:all|messenger)\/?$/.test(url.pathname) ||
      url.searchParams.get("asset_id") !== pageId || url.searchParams.getAll("thread_type").length !== 1 ||
      url.searchParams.get("thread_type") !== "FB_MESSAGE" || !getFacebookConversationNavigationId(normalized, pageId, psid) ||
      ["thread_id", "threadid", "tid"].some(key => url.searchParams.has(key))) return null;
  const business = url.searchParams.getAll("business_id");
  if (business.length > 1 || business.some(id => !/^\d{1,32}$/.test(id))) return null;
  return normalized;
}

/** Accept a conversation URL returned by Meta; never manufacture one from a PSID.
 * `selected_item_id` is an inbox identifier, not a public-profile guarantee. */
export function normalizeFacebookConversationLink(value: unknown, pageId: string): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value, "https://www.facebook.com");
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["www.facebook.com", "facebook.com", "business.facebook.com"].includes(url.hostname)) return null;
    const pageKeys = ["asset_id", "page_id", "mailbox_id"];
    for (const key of ["asset_id", "page_id"]) {
      const values = url.searchParams.getAll(key);
      if (values.length > 1 || values.some(id => id !== pageId)) return null;
    }
    const mailboxValues = url.searchParams.getAll("mailbox_id");
    if (mailboxValues.length > 1 || mailboxValues.some(id => id !== "" && id !== pageId)) return null;
    const portfolios = url.searchParams.getAll("bpn_id");
    if (portfolios.length > 1 || portfolios.some(id => !/^\d{1,32}$/.test(id))) return null;
    const navRefs = url.searchParams.getAll("nav_ref");
    if (navRefs.length > 1 || navRefs.some(value => !/^[A-Za-z0-9_.:-]{1,100}$/.test(value))) return null;
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
          !["asset_id", "page_id", "mailbox_id"].some(key => url.searchParams.get(key) === pageId) || !hasThread) return null;
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
    const allowed = new Set([...pageKeys, ...threadKeys, "thread_type", "business_id", "section", "bpn_id", "nav_ref"]);
    for (const key of [...url.searchParams.keys()]) if (!allowed.has(key)) url.searchParams.delete(key);
    url.hash = "";
    return url.toString();
  } catch { return null; }
}
