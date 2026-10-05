const messages: Record<string, string> = {
  page_reconnection_required: "This Page needs to be reconnected. Ask an Owner to reconnect it in Integrations.",
  profile_conversation_access_unavailable: "Facebook denied access to this Page's conversations. Ask an Owner to check Page access in Integrations.",
  profile_conversation_not_found: "Facebook did not return a Messenger conversation for this customer. Open this Page's inbox and select the customer there.",
  profile_conversation_participants_unmatched: "Facebook's conversation result did not match this Page and customer. Open this Page's inbox and select the customer there.",
  profile_conversation_ambiguous: "Facebook returned an ambiguous conversation result. TENH cannot safely select a chat. Open this Page's inbox and select the customer there.",
  facebook_direct_link_required: "Facebook found this conversation but did not provide a verified Business Suite link. Open this Page's inbox and select the customer there.",
  profile_conversation_link_unavailable: "Facebook did not return usable conversation information. Please try again.",
  profile_conversation_request_failed: "TENH could not complete the Facebook conversation lookup. Please try again.",
  profile_conversation_lookup_failed: "TENH could not complete the Facebook conversation lookup. Please try again.",
};

/** Display only fixed messages; unknown reasons and server error text stay private. */
export function facebookConversationNavigationError(reason: unknown, status = 200): string {
  if (typeof reason === "string" && Object.hasOwn(messages, reason)) return messages[reason];
  switch (status) {
    case 401: return "Your TENH session needs to be restored. Sign in and try again.";
    case 403: return "You do not have access to this conversation in the selected workspace.";
    case 409: return "The selected workspace, Page or customer changed. Reopen this conversation and try again.";
    case 424: return "Facebook access to this Page is unavailable. Ask an Owner to check this Page in Integrations.";
    case 400:
    case 404: return "The Facebook conversation could not be verified. Reopen it and try again.";
  }
  return status >= 500
    ? "TENH could not check this Facebook conversation. Please try again."
    : "An exact conversation link is unavailable. Open this Page's inbox and select the customer there.";
}
