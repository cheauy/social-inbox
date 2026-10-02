export const navigationFailureReasons = {
  facebook_customer_mismatch: "Facebook is showing a different customer.",
  conversation_mismatch: "Facebook's selected conversation does not match the requested destination.",
  facebook_conversation_mismatch: "Facebook loaded a different conversation destination.",
  facebook_conversation_changed: "Facebook changed the conversation during verification.",
  facebook_chat_not_ready: "Facebook has not loaded a matching chat header and message box.",
  profile_customer_heading_missing: "The matching customer panel is not visible in Facebook.",
  profile_link_not_rendered: "Facebook has not displayed a verifiable customer profile link.",
  profile_action_without_link: "Facebook's profile button has no verifiable destination.",
  profile_link_format_unsupported: "Facebook's profile link could not be verified.",
  profile_link_label_unrecognized: "Facebook's profile link label could not be verified.",
  ambiguous_profile: "Facebook's customer identity is ambiguous.",
  facebook_customer_name_unavailable: "The provider did not supply a customer name for verification.",
  facebook_provider_link_unavailable: "The provider conversation destination is unavailable.",
  profile_conversation_link_unavailable: "The provider conversation destination is unavailable.",
  facebook_bridge_unavailable: "TENH Extension could not inspect Facebook's loaded chat.",
  facebook_navigation_guard_unavailable: "TENH Extension could not safely monitor the temporary Facebook tab.",
  facebook_sign_in_required: "Sign in to Facebook in this Chrome profile.",
  facebook_inbox_load_failed: "Facebook could not load its inbox.",
  facebook_no_contact_card: "Facebook does not provide a customer contact card for this chat.",
  facebook_tab_in_use: "The Facebook tab was taken over during verification.",
  facebook_tab_closed: "The Facebook tab was closed during verification.",
  facebook_tab_unavailable: "The Facebook tab could not be opened.",
  facebook_customer_selection_unverified: "Facebook's selected customer could not be verified.",
  conversation_context_mismatch: "The selected TENH conversation or its authorization changed.",
  conversation_context_incomplete: "The conversation context is incomplete.",
  conversation_authorization_unavailable: "TENH could not check this conversation's authorization.",
  tenh_sign_in_required: "Sign in to TENH and reconnect this browser.",
  website_update_required: "Refresh TENH before trying again.",
  extension_refresh_required: "Refresh TENH after updating the extension.",
  extension_request_failed: "TENH Extension could not complete this request.",
  extension_response_unavailable: "TENH Extension did not respond in time.",
  facebook_navigation_cancelled: "Conversation verification was cancelled.",
  facebook_navigation_busy: "TENH Extension is already checking a conversation.",
  untrusted_sender: "TENH Extension could not authorize this request.",
  facebook_navigation_failed: "TENH Extension could not complete conversation verification.",
  facebook_navigation_unverified: "TENH Extension could not verify this customer.",
} as const;
export const navigationFailurePhases = {
  prepare: "Preparing the Facebook conversation",
  before_activation: "Before bringing Facebook forward",
  after_activation: "After bringing Facebook forward",
  commit: "Opening the prepared Facebook conversation",
} as const;
type Reason = keyof typeof navigationFailureReasons;
type Phase = keyof typeof navigationFailurePhases;
export type NavigationFailure = {
  opened: boolean; exactRequested: false; verified: false; reason: Reason; phase: Phase;
  verificationReason?: Reason; focusReturned?: boolean; temporaryTabClosed?: boolean;
  diagnostics: { dom: Partial<Record<"headerCandidates" | "matchingHeaders" | "headingRegions" | "cardRegions" | "profileActions" | "linkActions", number>> & {
    composerFound?: boolean; visibility?: "hidden" | "visible" | "prerender"; routeKind?: "direct" | "redirected" | "unrecognized";
  } };
};
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function reason(value: unknown): Reason | undefined {
  return typeof value === "string" && Object.hasOwn(navigationFailureReasons, value) ? value as Reason : undefined;
}
/** Copy fixed enums and bounded structural facts; never customer or routing data. */
export function readNavigationFailure(value: unknown, fallbackPhase: Phase, fallbackReason: Reason = "facebook_navigation_unverified"): NavigationFailure {
  const data = record(value), details = record(data.diagnostics), source = record(details.dom);
  const dom: NavigationFailure["diagnostics"]["dom"] = {};
  for (const key of ["headerCandidates", "matchingHeaders", "headingRegions", "cardRegions", "profileActions", "linkActions"] as const) {
    if (Number.isInteger(source[key]) && Number(source[key]) >= 0) dom[key] = Math.min(Number(source[key]), 10000);
  }
  if (typeof source.composerFound === "boolean") dom.composerFound = source.composerFound;
  if (typeof source.visibility === "string" && ["hidden", "visible", "prerender"].includes(source.visibility)) dom.visibility = source.visibility as "hidden" | "visible" | "prerender";
  if (typeof source.routeKind === "string" && ["direct", "redirected", "unrecognized"].includes(source.routeKind)) dom.routeKind = source.routeKind as "direct" | "redirected" | "unrecognized";
  const phase = typeof data.phase === "string" && Object.hasOwn(navigationFailurePhases, data.phase) ? data.phase as Phase : fallbackPhase;
  return { opened: data.opened === true, exactRequested: false, verified: false, reason: reason(data.reason) ?? fallbackReason, phase,
    ...(reason(data.verificationReason) ? { verificationReason: reason(data.verificationReason) } : {}),
    ...(typeof data.focusReturned === "boolean" ? { focusReturned: data.focusReturned } : {}),
    ...(typeof data.temporaryTabClosed === "boolean" ? { temporaryTabClosed: data.temporaryTabClosed } : {}), diagnostics: { dom } };
}
export function navigationFailureNotice(value: NavigationFailure): string {
  const explanation = navigationFailureReasons[value.verificationReason ?? value.reason];
  return value.opened && value.phase === "after_activation"
    ? `Facebook opened, but the customer was not verified. ${explanation} Confirm the customer before replying there.`
    : `${explanation} Open the Page inbox and select the customer there.`;
}
