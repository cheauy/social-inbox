"use client";

import { useEffect, useRef, useState } from "react";
import { CustomerAvatar } from "@/components/customer-avatar";
import { getFacebookCustomerProfileUrl, normalizeCustomerProfileLink } from "@/lib/facebook/customer-profile-url";
import { profileLookupError } from "@/lib/facebook/profile-lookup-error";
import { useCompanion } from "@/lib/extension/use-companion";
import type { InboxConversation } from "@/types/inbox";

function supportsAutomaticLookup(version: string | null) {
  const parts = version?.split(".").map(Number);
  return Boolean(parts && parts.length >= 3 && parts.every(Number.isFinite) &&
    (parts[0] > 1 || (parts[0] === 1 && (parts[1] > 2 || (parts[1] === 2 && parts[2] >= 27)))));
}

/** Saved links open directly. Unknown Messenger profiles use a context-bound
 * extension lookup, with automatic persistence and no manual entry form. */
export function CustomerFacebookAvatar({ conversation }: { conversation: InboxConversation }) {
  const contact = conversation.contact;
  const isFacebook = conversation.social_account?.platform === "facebook";
  const pageId = conversation.social_account?.platform_account_id;
  const key = JSON.stringify([conversation.business_id, conversation.id, contact?.id, contact?.platform_user_id, pageId]);
  const currentKey = useRef(key); currentKey.current = key;
  const generation = useRef(0);
  const inFlight = useRef(false);
  const [stored, setStored] = useState<{ key: string; url: string | null } | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [lookupDetails, setLookupDetails] = useState<string | null>(null);
  const [detailsCopied, setDetailsCopied] = useState(false);
  const companion = useCompanion();
  const safeUrl = (value: unknown) => {
    const url = normalizeCustomerProfileLink(value, contact?.platform_user_id);
    return url && new URL(url).searchParams.get("id") !== pageId ? url : null;
  };
  const url = safeUrl(stored?.key === key ? stored.url : getFacebookCustomerProfileUrl(contact));
  const endpoint = `/api/conversations/${encodeURIComponent(conversation.id)}/facebook-profile`;

  useEffect(() => {
    const controller = new AbortController();
    const attempt = ++generation.current;
    inFlight.current = false; setBusy(false); setNotice(""); setLookupDetails(null); setDetailsCopied(false);
    if (isFacebook) void fetch(endpoint, { cache: "no-store", signal: controller.signal })
      .then(response => response.json()).then(data => {
        if (!controller.signal.aborted && generation.current === attempt && data.success && currentKey.current === key) {
          setStored({ key, url: data.profileUrl ?? null });
        }
      }).catch(() => { /* Profile lookup remains available if storage is offline. */ });
    return () => { controller.abort(); generation.current++; inFlight.current = false; };
  }, [key, endpoint, isFacebook]);

  async function openAutomaticProfile() {
    if (inFlight.current || !isFacebook || !contact) return;
    if (conversation.source_type !== "messenger") {
      setNotice(profileLookupError("profile_messenger_required")); return;
    }
    if (!companion.installed || !supportsAutomaticLookup(companion.version)) {
      setNotice("Use Chrome on your computer with TENH Companion 1.2.27 or later enabled, then refresh TENH."); return;
    }
    if (!pageId || !contact.platform_user_id || !conversation.business_id) {
      setNotice(profileLookupError("profile_context_incomplete")); return;
    }
    const context = { pageId, threadId: contact.platform_user_id, conversationId: conversation.id, businessId: conversation.business_id };
    const attempt = ++generation.current;
    const current = () => currentKey.current === key && generation.current === attempt;
    inFlight.current = true; setBusy(true); setNotice(""); setLookupDetails(null); setDetailsCopied(false);
    try {
      // Capture the existing revision before lookup so another agent's newer
      // customer edit cannot be overwritten when Facebook takes time to load.
      const snapshot = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(8000) })
        .then(response => response.json()).catch(() => null);
      if (!current()) return;
      const result = await companion.openFacebookProfile({ ...context, customerName: contact.full_name });
      if (!current()) return;
      if (!result?.resolved || !result.verified || !result.openToken) {
        const detail = result?.lookupDetails;
        setLookupDetails(JSON.stringify({ extensionVersion: companion.version,
          reason: /^[a-z_]{1,80}$/.test(result?.reason || "") ? result?.reason : "extension_timeout",
          tenhCustomerName: contact.full_name?.slice(0, 200), expectedFacebookName: detail?.expectedName?.slice(0, 200) ?? null,
          headingRegions: detail?.headingRegions ?? null, cardRegions: detail?.cardRegions ?? null,
          profileActions: detail?.profileActions ?? null, linkActions: detail?.linkActions ?? null }, null, 2));
        setNotice(profileLookupError(result?.reason || "extension_timeout")); return;
      }
      if (result.pageId !== context.pageId || result.threadId !== context.threadId ||
          result.conversationId !== context.conversationId || result.businessId !== context.businessId) {
        setNotice(profileLookupError("profile_context_mismatch")); return;
      }
      const resolvedUrl = safeUrl(result.profileUrl);
      if (!resolvedUrl) { setNotice(profileLookupError("profile_url_unsupported")); return; }
      // This second phase is invoked automatically by the same click, only if
      // the agent is still viewing the same customer after the lookup finishes.
      const opened = await companion.openResolvedFacebookProfile(result.openToken, context);
      if (!current()) return;
      if (!opened?.opened || !opened.verified || safeUrl(opened.profileUrl) !== resolvedUrl ||
          opened.pageId !== context.pageId || opened.threadId !== context.threadId ||
          opened.conversationId !== context.conversationId || opened.businessId !== context.businessId) {
        setNotice(profileLookupError(opened?.reason || "profile_open_unconfirmed")); return;
      }
      setStored({ key, url: resolvedUrl });
      let saved = false;
      if (snapshot?.success && Object.prototype.hasOwnProperty.call(snapshot, "updatedAt")) {
        saved = await fetch(endpoint, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          // The extension verified the rendered link for this exact context.
          body: JSON.stringify({ profileUrl: resolvedUrl, confirmed: true, expectedUpdatedAt: snapshot.updatedAt }),
          signal: AbortSignal.timeout(8000),
        }).then(async response => response.ok && (await response.json()).success === true).catch(() => false);
      }
      if (current() && !saved) setNotice("Profile opened, but TENH could not save its link for the team. Your customer edit permissions or a newer customer update may prevent saving.");
    } catch {
      if (current()) setNotice(profileLookupError("extension_request_failed"));
    } finally {
      if (current()) { inFlight.current = false; setBusy(false); }
    }
  }

  async function copyLookupDetails() {
    if (!lookupDetails) return;
    const attempt = generation.current;
    try {
      await navigator.clipboard.writeText(lookupDetails);
      if (attempt === generation.current) setDetailsCopied(true);
    } catch { /* The visible details can still be selected and copied. */ }
  }

  if (!contact) return null;
  const image = <CustomerAvatar src={contact.profile_picture_url} name={contact.full_name} contactId={contact.id} platform={conversation.social_account?.platform} eager className="h-full w-full text-2xl" />;
  const avatarClass = "block h-16 w-16 overflow-hidden rounded-full outline-none ring-offset-2 hover:ring-2 hover:ring-blue-400 focus-visible:ring-2";
  return <div className="relative flex shrink-0 flex-col items-start gap-1">
    {isFacebook && url ? <a href={url} target="_blank" rel="noopener noreferrer" title="View Facebook profile" aria-label="View customer Facebook profile" className={avatarClass}>{image}</a>
      : <button type="button" disabled={!isFacebook || busy} aria-busy={busy} title="View Facebook profile" aria-label={isFacebook ? "View customer Facebook profile" : "Customer avatar"} onClick={() => void openAutomaticProfile()} className={`${avatarClass} disabled:cursor-default ${busy ? "animate-pulse" : ""}`}>{image}</button>}
    {busy ? <span role="status" className="text-xs text-slate-500">Finding profile…</span> : null}
    {notice ? <div role="status" className="absolute left-0 top-[72px] z-30 w-64 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg"><button type="button" aria-label="Dismiss profile notice" onClick={() => setNotice("")} className="float-right ml-2 px-1">×</button>{notice}
      {lookupDetails ? <><button type="button" onClick={() => void copyLookupDetails()} className="mt-2 block font-medium text-blue-600">{detailsCopied ? "Copied" : "Copy lookup details"}</button>
        <details className="mt-2"><summary className="cursor-pointer">Show lookup details</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px]">{lookupDetails}</pre></details></> : null}
    </div> : null}
  </div>;
}
