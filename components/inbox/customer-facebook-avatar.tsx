"use client";

import { useEffect, useRef, useState } from "react";
import { CustomerAvatar } from "@/components/customer-avatar";
import { useCompanion } from "@/lib/extension/use-companion";
import { getFacebookCustomerProfileUrl, normalizeFacebookProfileUrl } from "@/lib/facebook/customer-profile-url";
import type { InboxConversation } from "@/types/inbox";

function supportedVersion(version: string | null) {
  const parts = (version ?? "").split(".").map(Number);
  return parts[0] > 1 || (parts[0] === 1 && (parts[1] > 2 || (parts[1] === 2 && parts[2] >= 14)));
}

export function CustomerFacebookAvatar({ conversation }: { conversation: InboxConversation }) {
  const { installed, version, openFacebookProfile } = useCompanion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const attempt = useRef(0);
  const pendingTab = useRef<Window | null>(null);
  const locked = useRef(false);
  const contact = conversation.contact;
  const pageId = conversation.social_account?.platform_account_id;
  const isFacebook = conversation.social_account?.platform === "facebook";
  const savedUrl = getFacebookCustomerProfileUrl(contact);
  const cacheKey = `tenh:facebook-profile:v1:${JSON.stringify([conversation.business_id, pageId, contact?.id, contact?.platform_user_id, contact?.full_name])}`;

  useEffect(() => () => {
    attempt.current += 1;
    pendingTab.current?.close();
    pendingTab.current = null;
  }, []);

  async function openProfile() {
    if (locked.current || !isFacebook || !contact || !pageId) return;
    let cachedUrl = null;
    try { cachedUrl = normalizeFacebookProfileUrl(localStorage.getItem(cacheKey)); } catch { /* Storage is optional. */ }
    const knownUrl = savedUrl ?? cachedUrl;
    setError("");
    setFallbackUrl(null);
    if (!knownUrl && (!installed || !supportedVersion(version))) {
      setError(installed ? "Update TENH Companion to 1.2.14 or later, then refresh TENH and Facebook." : "Enable TENH Companion in this browser and refresh TENH to find this customer's profile.");
      return;
    }
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    pendingTab.current = tab;
    const currentAttempt = ++attempt.current;
    locked.current = true;
    setBusy(true);
    try {
      let url = knownUrl;
      if (!url) {
        const result = await openFacebookProfile({ pageId, threadId: contact.platform_user_id, conversationId: conversation.id, customerName: contact.full_name });
        if (currentAttempt !== attempt.current) return;
        if (result?.resolved && result.pageId === pageId) url = normalizeFacebookProfileUrl(result.profileUrl);
        if (!url) {
          const reason = result?.reason;
          throw new Error(reason === "ambiguous_customer" || reason === "ambiguous_profile"
            ? "More than one matching customer was found. TENH did not choose a profile."
            : reason === "page_mismatch_or_sign_in"
              ? "Sign into Facebook with access to this conversation's Page, then try again."
              : reason === "customer_not_found"
                ? "No unique customer with this name was found in this Page's Messenger search."
                : "Facebook did not expose a matching profile link. Check Page access and refresh Facebook, then retry.");
        }
        try { localStorage.setItem(cacheKey, url); } catch { /* Still open the resolved link. */ }
      }
      if (currentAttempt !== attempt.current) return;
      setFallbackUrl(url);
      if (tab && !tab.closed) { tab.location.replace(url); pendingTab.current = null; }
      else setError("The new tab was blocked. Use View Facebook profile below.");
    } catch (reason) {
      tab?.close();
      if (currentAttempt === attempt.current) setError(reason instanceof Error ? reason.message : "Unable to open this profile.");
    } finally {
      if (currentAttempt !== attempt.current) tab?.close();
      else { pendingTab.current = null; locked.current = false; setBusy(false); }
    }
  }

  if (!contact) return null;
  return <div className="flex shrink-0 flex-col items-start gap-1">
    <button type="button" onClick={() => void openProfile()} disabled={!isFacebook || busy}
      aria-label={isFacebook ? "View customer Facebook profile" : "Customer avatar"}
      title={isFacebook ? "View customer Facebook profile" : undefined}
      className={`group relative h-16 w-16 overflow-hidden rounded-full outline-none ring-offset-2 transition ${isFacebook ? "hover:ring-2 hover:ring-blue-400 focus-visible:ring-2 focus-visible:ring-blue-500" : ""} disabled:opacity-80`}>
      <CustomerAvatar src={contact.profile_picture_url} name={contact.full_name} contactId={contact.id} platform={conversation.social_account?.platform} eager className="h-full w-full text-2xl" />
      {isFacebook ? <span className={`absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/50 to-transparent transition ${busy ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}><span className="mb-1 text-[9px] font-semibold text-white">{busy ? "Finding..." : "View profile"}</span></span> : null}
    </button>
    {error ? <p role="alert" className="max-w-40 text-xs leading-4 text-amber-800">{error}</p> : null}
    {error && fallbackUrl ? <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" className="max-w-40 text-xs text-blue-600 underline">View Facebook profile</a> : null}
  </div>;
}
