"use client";

import { useEffect, useRef, useState } from "react";
import { CustomerAvatar } from "@/components/customer-avatar";
import { useCompanion } from "@/lib/extension/use-companion";
import { getFacebookCustomerProfileUrl, normalizeCustomerProfileLink } from "@/lib/facebook/customer-profile-url";
import { profileLookupError } from "@/lib/facebook/profile-lookup-error";
import type { InboxConversation } from "@/types/inbox";

function supportedVersion(version: string | null) {
  const parts = (version ?? "").split(".").map(Number);
  return parts[0] > 1 || (parts[0] === 1 && (parts[1] > 2 || (parts[1] === 2 && parts[2] >= 17)));
}

export function CustomerFacebookAvatar({ conversation }: { conversation: InboxConversation }) {
  const { installed, version, openFacebookProfile, openResolvedFacebookProfile } = useCompanion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState("");
  const [copied, setCopied] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const attempt = useRef(0);
  const locked = useRef(false);
  const contact = conversation.contact;
  const pageId = conversation.social_account?.platform_account_id;
  const isFacebook = conversation.social_account?.platform === "facebook";
  const savedUrl = getFacebookCustomerProfileUrl(contact);
  const cacheKey = `tenh:facebook-profile:v1:${JSON.stringify([conversation.business_id, pageId, contact?.id, contact?.platform_user_id, contact?.full_name])}`;

  useEffect(() => () => {
    attempt.current += 1;
  }, []);

  async function openProfile() {
    if (locked.current || !isFacebook || !contact || !pageId) return;
    let cachedUrl = null;
    try { cachedUrl = normalizeCustomerProfileLink(localStorage.getItem(cacheKey), contact.platform_user_id); } catch { /* Storage is optional. */ }
    const knownUrl = cachedUrl ?? savedUrl;
    setError("");
    setDiagnostic("");
    setCopied(false);
    setFallbackUrl(null);
    if (knownUrl) {
      // Open the actual profile in the original click gesture.
      setFallbackUrl(knownUrl);
      window.open(knownUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (!installed || !supportedVersion(version)) {
      setError(installed ? "Update TENH Companion to 1.2.17 and refresh TENH to enable automatic profile lookup." : "Enable TENH Companion and refresh TENH to open customer profiles automatically.");
      return;
    }
    const currentAttempt = ++attempt.current;
    locked.current = true;
    setBusy(true);
    try {
      const started = Date.now();
      const result = await openFacebookProfile({ pageId, threadId: contact.platform_user_id, conversationId: conversation.id, customerName: contact.full_name });
      if (currentAttempt !== attempt.current) return;
      const url = result?.resolved && result.pageId === pageId ? normalizeCustomerProfileLink(result.profileUrl, contact.platform_user_id) : null;
      if (!url) {
        const reason = !result ? "extension_timeout"
          : result.resolved ? (result.pageId !== pageId ? "profile_page_mismatch" : "profile_url_unsupported")
          : result.reason || "profile_link_unavailable";
        // No messages, cookies, tokens, or profile links in diagnostic output.
        setDiagnostic(`TENH profile lookup | extension=${version ?? "unknown"} | reason=${/^[a-z_]{1,80}$/.test(reason) ? reason : "unknown"} | page=${pageId} | durationMs=${Date.now() - started}`);
        throw new Error(profileLookupError(reason));
      }
      try { localStorage.setItem(cacheKey, url); } catch { /* Still open the resolved link. */ }
      if (currentAttempt !== attempt.current) return;
      setFallbackUrl(url);
      // Confirm the same customer is selected before asking Chrome to open the resolved URL.
      const opened = result?.openToken ? await openResolvedFacebookProfile(result.openToken) : null;
      if (currentAttempt === attempt.current && !opened?.opened) setError("Your profile link is ready. Use View Facebook profile below to open it.");
    } catch (reason) {
      if (currentAttempt === attempt.current) {
          setError(reason instanceof Error ? reason.message : "Unable to open this profile.");
      }
    } finally {
      if (currentAttempt === attempt.current) { locked.current = false; setBusy(false); }
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
    {error && diagnostic ? <div className="max-w-40">
      <button type="button" className="text-xs font-semibold text-blue-600 underline" onClick={async () => {
        try { await navigator.clipboard.writeText(diagnostic); setCopied(true); }
        catch { setCopied(false); }
      }}>{copied ? "Copied" : "Copy error details"}</button>
      <details className="mt-1 text-[10px] text-slate-500"><summary>Technical details</summary><p className="break-all select-text">{diagnostic}</p></details>
    </div> : null}
    {fallbackUrl ? <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" className="max-w-40 text-xs text-blue-600 underline">View Facebook profile</a> : null}
  </div>;
}
