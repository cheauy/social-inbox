const messages: Record<string, string> = {
  ambiguous_customer: "More than one matching customer was found. TENH did not choose a profile.",
  ambiguous_profile: "Facebook showed more than one matching profile link. TENH did not choose one.",
  page_mismatch_or_sign_in: "The lookup could not load this conversation's Facebook Page. Check that your Facebook account can access that Page.",
  customer_not_found: "The customer search did not return one stable matching result. The name may differ on Facebook or the search may still be loading.",
  search_unavailable: "TENH could not find the search field in Business Suite. This needs a search-detection fix, not a new customer ID.",
  search_interrupted: "Business Suite changed or reset the search field during lookup. Please retry.",
  profile_link_unavailable: "TENH selected a customer but could not read a matching View profile link. The profile panel may be closed or Facebook may use a different control.",
  extension_refresh_required: "The extension scripts need reloading. Reload TENH Companion, then refresh TENH and Facebook.",
  extension_request_failed: "The browser could not complete the extension request. Reload TENH Companion and refresh TENH.",
  extension_timeout: "TENH did not receive an extension reply before the timeout. Check that TENH Companion is enabled and refresh TENH.",
  facebook_bridge_unavailable: "TENH Companion could not open its Facebook lookup tab.",
  profile_resolution_unavailable: "The extension's Facebook lookup was interrupted or failed to run. Copy the error details so this can be diagnosed.",
  profile_context_incomplete: "This conversation is missing its Facebook Page or customer name.",
  profile_page_mismatch: "The extension returned a profile for a different Page. TENH did not open it.",
  profile_url_unsupported: "The extension returned a link that TENH cannot verify as a Facebook profile. TENH did not open it.",
};

export function profileLookupError(reason: string): string {
  return messages[reason] ?? "The profile lookup failed. Copy the error details so the failing step can be checked.";
}
