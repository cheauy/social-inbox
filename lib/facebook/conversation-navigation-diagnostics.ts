import { getFacebookConversationNavigationId, normalizeBusinessSuiteConversationLink, normalizeFacebookConversationLink } from "./conversation-link";

export const providerLinkStates = { missing: "Missing", rejected: "Rejected by link validation", retained: "Retained" } as const;
export const providerRouteKinds = { suite: "Business Suite", legacy_page_inbox: "Legacy Page inbox", messages: "Facebook Messages", unknown: "Unknown" } as const;
export const directLinkRejectReasons = {
  none: "Direct link accepted",
  provider_link_missing: "Facebook returned no link",
  provider_link_rejected: "Provider link did not pass validation",
  legacy_page_inbox_route: "Legacy Page inbox does not verify a Suite destination",
  messages_route: "Messages route does not verify a Suite destination",
  unsupported_suite_route: "Suite path does not select a supported inbox",
  missing_page_asset: "Suite link is missing the required Page asset",
  invalid_thread_type: "Suite link needs one FB_MESSAGE thread type",
  invalid_selected_item: "Suite link lacks a valid, distinct selected conversation",
  conflicting_thread_parameters: "Suite link includes conflicting thread routing",
  invalid_business_id: "Suite link includes invalid business routing",
} as const;
export type NavigationDiagnostics = {
  providerLinkState: keyof typeof providerLinkStates;
  providerRouteKind: keyof typeof providerRouteKinds;
  directLinkRejectReason: keyof typeof directLinkRejectReasons;
  cacheUsed: boolean;
};

/** Explanation only: the existing strict validator remains the navigation authority. */
export function facebookNavigationDiagnostics(
  thread: { providerLink: string | null; linkMissing: boolean },
  pageId: string,
  recipientId: string,
  cacheUsed: boolean,
): NavigationDiagnostics {
  const details: NavigationDiagnostics = {
    providerLinkState: thread.linkMissing ? "missing" : thread.providerLink ? "retained" : "rejected",
    providerRouteKind: "unknown",
    directLinkRejectReason: thread.linkMissing ? "provider_link_missing" : "provider_link_rejected",
    cacheUsed,
  };
  if (!thread.providerLink) return details;
  const normalized = normalizeFacebookConversationLink(thread.providerLink, pageId);
  if (!normalized) return { ...details, providerLinkState: "rejected", directLinkRejectReason: "provider_link_rejected" };
  const url = new URL(normalized);
  details.providerRouteKind = url.hostname === "business.facebook.com" ? "suite"
    : url.pathname.startsWith("/messages") ? "messages" : "legacy_page_inbox";
  if (normalizeBusinessSuiteConversationLink(thread.providerLink, pageId, recipientId)) {
    details.directLinkRejectReason = "none";
  } else if (details.providerRouteKind === "legacy_page_inbox") {
    details.directLinkRejectReason = "legacy_page_inbox_route";
  } else if (details.providerRouteKind === "messages") {
    details.directLinkRejectReason = "messages_route";
  } else if (!/^\/latest\/inbox\/(?:all|messenger)\/?$/.test(url.pathname)) {
    details.directLinkRejectReason = "unsupported_suite_route";
  } else if (url.searchParams.get("asset_id") !== pageId) {
    details.directLinkRejectReason = "missing_page_asset";
  } else if (url.searchParams.getAll("thread_type").length !== 1 || url.searchParams.get("thread_type") !== "FB_MESSAGE") {
    details.directLinkRejectReason = "invalid_thread_type";
  } else if (!getFacebookConversationNavigationId(thread.providerLink, pageId, recipientId)) {
    details.directLinkRejectReason = "invalid_selected_item";
  } else if (["thread_id", "threadid", "tid"].some(key => url.searchParams.has(key))) {
    details.directLinkRejectReason = "conflicting_thread_parameters";
  } else {
    const business = url.searchParams.getAll("business_id");
    if (business.length > 1 || business.some(id => !/^\d{1,32}$/.test(id))) details.directLinkRejectReason = "invalid_business_id";
  }
  return details;
}

/** Never render arbitrary response strings or additional response fields. */
export function readNavigationDiagnostics(value: unknown): Partial<NavigationDiagnostics> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const details: Partial<NavigationDiagnostics> = {};
  if (Object.hasOwn(record, "providerLinkState") && typeof record.providerLinkState === "string" && Object.hasOwn(providerLinkStates, record.providerLinkState)) {
    details.providerLinkState = record.providerLinkState as NavigationDiagnostics["providerLinkState"];
  }
  if (Object.hasOwn(record, "providerRouteKind") && typeof record.providerRouteKind === "string" && Object.hasOwn(providerRouteKinds, record.providerRouteKind)) {
    details.providerRouteKind = record.providerRouteKind as NavigationDiagnostics["providerRouteKind"];
  }
  if (Object.hasOwn(record, "directLinkRejectReason") && typeof record.directLinkRejectReason === "string" && Object.hasOwn(directLinkRejectReasons, record.directLinkRejectReason)) {
    details.directLinkRejectReason = record.directLinkRejectReason as NavigationDiagnostics["directLinkRejectReason"];
  }
  if (Object.hasOwn(record, "cacheUsed") && typeof record.cacheUsed === "boolean") details.cacheUsed = record.cacheUsed;
  return Object.keys(details).length ? details : null;
}
