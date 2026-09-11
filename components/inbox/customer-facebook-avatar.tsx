"use client";

import { useEffect, useRef, useState } from "react";
import { CustomerAvatar } from "@/components/customer-avatar";
import { useCompanion } from "@/lib/extension/use-companion";
import { getFacebookCustomerProfileUrl, normalizeCustomerProfileLink } from "@/lib/facebook/customer-profile-url";
import { profileLookupError } from "@/lib/facebook/profile-lookup-error";
import type { InboxConversation } from "@/types/inbox";

const CACHE_TTL_MS = 60 * 60 * 1000;
function supportedVersion(version: string | null) {
  const parts = (version ?? "").split(".").map(Number);
  return parts[0] > 1 || (parts[0] === 1 && (parts[1] > 2 || (parts[1] === 2 && parts[2] >= 18)));
}

export function CustomerFacebookAvatar({ conversation }: { conversation: InboxConversation }) {
  const { installed, version, openFacebookProfile, openResolvedFacebookProfile } = useCompanion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState("");
  const [copied, setCopied] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const attempt = useRef(0);
  const locked = useRef(false);
  const contact = conversation.contact;
  const pageId = conversation.social_account?.platform_account_id;
  const isFacebook = conversation.social_account?.platform === "facebook";
  const identityKey = JSON.stringify([conversation.business_id, pageId, conversation.id, contact?.id, contact?.platform_user_id, contact?.full_name]);
  const liveIdentity = useRef(identityKey);
  liveIdentity.current = identityKey;
  // Ignore the old unverified localStorage cache. New entries are short-lived,
  // browser-session only, and written only after profile validation + opening.
  const cacheKey = `tenh:facebook-profile:v2:${identityKey}`;

  useEffect(() => {
    attempt.current += 1;
    locked.current = false;
    setBusy(false);
    setError("");
    setDiagnostic("");
    setCopied(false);
    setFallbackUrl(null);
    setResolvedId(null);
    return () => { attempt.current += 1; locked.current = false; };
  }, [identityKey]);

  async function openProfile() {
    if (locked.current || !isFacebook || !contact || !pageId) return;
    const context = { businessId: conversation.business_id, pageId, threadId: contact.platform_user_id, conversationId: conversation.id };
    const safeUrl = (value: unknown) => {
      const url = normalizeCustomerProfileLink(value, context.threadId);
      return url && new URL(url).searchParams.get("id") !== pageId ? url : null;
    };
    let cachedUrl: string | null = null;
    try {
      const entry = JSON.parse(sessionStorage.getItem(cacheKey) ?? "null");
      if (entry?.verified === true && Number(entry.expiresAt) > Date.now() && Number(entry.expiresAt) <= Date.now() + CACHE_TTL_MS) {
        cachedUrl = safeUrl(entry.url);
      }
    } catch { /* Cache is optional. */ }
    const knownUrl = safeUrl(getFacebookCustomerProfileUrl(contact)) ?? cachedUrl;
    setError(""); setDiagnostic(""); setCopied(false); setFallbackUrl(null); setResolvedId(null);
    if (knownUrl) {
      setResolvedId(new URL(knownUrl).searchParams.get("id"));
      setFallbackUrl(knownUrl);
      window.open(knownUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (!installed || !supportedVersion(version)) {
      setError(installed
        ? "Update TENH Companion to 1.2.18 or newer, then refresh TENH to use profile lookup."
        : "Enable TENH Companion and refresh TENH to look up this customer's Facebook profile.");
      return;
    }
    const currentAttempt = ++attempt.current;
    const stillSelected = () => currentAttempt === attempt.current && liveIdentity.current === identityKey;
    locked.current = true;
    setBusy(true);
    const started = Date.now();
    const fail = (reason: string) => {
      setDiagnostic(`TENH profile lookup | extension=${version ?? "unknown"} | reason=${/^[a-z_]{1,80}$/.test(reason) ? reason : "unknown"} | durationMs=${Date.now() - started}`);
      throw new Error(profileLookupError(reason));
    };
    try {
      const result = await openFacebookProfile({ ...context, customerName: contact.full_name });
      if (!stillSelected()) return;
      if (!result) return fail("extension_timeout");
      if (!result.resolved) return fail(result.reason || "profile_link_unavailable");
      if (!result.verified) return fail("profile_identity_unverified");
      if (result.pageId !== pageId || result.threadId !== context.threadId ||
          result.conversationId !== context.conversationId || result.businessId !== context.businessId) {
        return fail("profile_context_mismatch");
      }
      const url = safeUrl(result.profileUrl);
      if (!url || !result.openToken) return fail("profile_url_unsupported");
      // Only Chrome opens the tab after this confirmation. No guessed profile
      // URL and no Business Suite window is used as the visible fallback.
      const opened = await openResolvedFacebookProfile(result.openToken, context);
      if (!stillSelected()) return;
      if (!opened?.opened) {
        if (opened?.reason === "profile_tab_unavailable") setFallbackUrl(url);
        return fail(opened?.reason || "profile_open_unconfirmed");
      }
      const actualUrl = safeUrl(opened.profileUrl) ?? url;
      setResolvedId(new URL(actualUrl).searchParams.get("id"));
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ url: actualUrl, verified: true, expiresAt: Date.now() + CACHE_TTL_MS }));
      } catch { /* A storage failure must not affect the opened profile. */ }
    } catch (reason) {
      if (stillSelected()) setError(reason instanceof Error ? reason.message : "Unable to open this profile.");
    } finally {
      if (stillSelected()) { locked.current = false; setBusy(false); }
    }
  }

  if (!contact) return null;
  return <div className="flex shrink-0 flex-col items-start gap-1">
    <button type="button" onClick={() => void openProfile()} disabled={!isFacebook || busy}
      aria-busy={busy} aria-label={isFacebook ? "View customer Facebook profile" : "Customer avatar"}
      title={isFacebook ? "View customer Facebook profile" : undefined}
      className={`group relative h-16 w-16 overflow-hidden rounded-full outline-none ring-offset-2 transition ${isFacebook ? "hover:ring-2 hover:ring-blue-400 focus-visible:ring-2 focus-visible:ring-blue-500" : ""} disabled:opacity-80`}>
      <CustomerAvatar src={contact.profile_picture_url} name={contact.full_name} contactId={contact.id} platform={conversation.social_account?.platform} eager className="h-full w-full text-2xl" />
      {isFacebook ? <span className={`absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/50 to-transparent transition ${busy ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`}><span className="mb-1 text-[9px] font-semibold text-white">{busy ? "Finding..." : "View profile"}</span></span> : null}
    </button>
    {busy ? <p role="status" className="max-w-40 text-xs leading-4 text-slate-500">Checking this customer's Facebook profile…</p> : null}
    {resolvedId && !contact.facebook_profile_id ? <p className="max-w-40 break-all text-[10px] text-slate-500" title="Public ID from the resolved Facebook profile">Facebook profile ID: {resolvedId}</p> : null}
    {error ? <p role="alert" className="max-w-40 text-xs leading-4 text-amber-800">{error}</p> : null}
    {error && diagnostic ? <div className="max-w-40">
      <button type="button" className="text-xs font-semibold text-blue-600 underline" onClick={async () => {
        try { await navigator.clipboard.writeText(diagnostic); setCopied(true); } catch { setCopied(false); }
      }}>{copied ? "Copied" : "Copy error details"}</button>
      <details className="mt-1 text-[10px] text-slate-500"><summary>Technical details</summary><p className="break-all select-text">{diagnostic}</p></details>
    </div> : null}
    {fallbackUrl ? <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" className="max-w-40 text-xs text-blue-600 underline">View Facebook profile</a> : null}
  </div>;
}
