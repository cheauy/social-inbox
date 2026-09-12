"use client";
import { useEffect, useRef, useState } from "react";
import { CustomerAvatar } from "@/components/customer-avatar";
import { getFacebookCustomerProfileUrl, normalizeCustomerProfileLink } from "@/lib/facebook/customer-profile-url";
import { facebookCustomerLinks } from "@/lib/facebook/customer-navigation";
import type { InboxConversation } from "@/types/inbox";

/** A saved link opens directly, without an extension request or profile probe.
 * Extension events only trigger an authenticated re-read; their payload is not
 * trusted as customer data. Missing links are never labelled public profiles. */
export function CustomerFacebookAvatar({ conversation }: { conversation: InboxConversation }) {
  const contact = conversation.contact;
  const isFacebook = conversation.social_account?.platform === "facebook";
  const pageId = conversation.social_account?.platform_account_id;
  const key = `${conversation.business_id}:${conversation.id}:${contact?.id}`;
  const currentKey = useRef(key); currentKey.current = key;
  const [stored, setStored] = useState<{ key: string; url: string | null } | null>(null);
  const [notice, setNotice] = useState("");
  const safeUrl = (value: unknown) => {
    const url = normalizeCustomerProfileLink(value, contact?.platform_user_id);
    return url && new URL(url).searchParams.get("id") !== pageId ? url : null;
  };
  const url = safeUrl(stored?.key === key ? stored.url : getFacebookCustomerProfileUrl(contact));
  const links = facebookCustomerLinks(pageId, contact?.platform_user_id);
  useEffect(() => {
    setNotice("");
    if (!isFacebook) return;
    let disposed = false, sequence = 0, timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    const read = async () => {
      const seq = ++sequence;
      controller?.abort(); controller = new AbortController();
      try {
        const response = await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}/facebook-profile`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!disposed && seq === sequence && currentKey.current === key && response.ok && data.success) {
          setStored({ key, url: data.profileUrl ?? null });
        }
      } catch { /* Profile sync is optional. Never block the normal Inbox. */ }
    };
    const refresh = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { timer = null; void read(); }, 250); };
    const event = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin || e.data?.source !== "TENH_EXTENSION" || e.data?.type !== "TENH_SYNC_PUSH") return;
      const update = e.data.event;
      if (update?.type === "customer.profile.updated" && update.conversationId === conversation.id) refresh();
    };
    void read();
    window.addEventListener("message", event); window.addEventListener("focus", refresh);
    // Profile lookup only, while this customer's details are displayed. No message polling.
    const interval = window.setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    return () => { disposed = true; sequence++; controller?.abort(); if (timer) clearTimeout(timer); clearInterval(interval); window.removeEventListener("message", event); window.removeEventListener("focus", refresh); };
  }, [key, conversation.id, isFacebook]);
  if (!contact) return null;
  const image = <CustomerAvatar src={contact.profile_picture_url} name={contact.full_name} contactId={contact.id} platform={conversation.social_account?.platform} eager className="h-full w-full text-2xl" />;
  return <div className="relative flex shrink-0 flex-col items-start gap-1">
    {isFacebook && url ? <a href={url} target="_blank" rel="noopener noreferrer" title="View public Facebook profile" aria-label="View customer Facebook profile" className="block h-16 w-16 overflow-hidden rounded-full outline-none ring-offset-2 hover:ring-2 hover:ring-blue-400 focus-visible:ring-2">{image}</a>
      : <button type="button" disabled={!isFacebook} aria-label={isFacebook ? "Facebook profile availability" : "Customer avatar"} onClick={() => setNotice("No public profile link has been synchronized yet. Open this customer in Business Suite and expose their View profile link. The companion can save that visible link; it cannot convert a Messenger ID into a public profile ID.")} className="h-16 w-16 overflow-hidden rounded-full">{image}</button>}
    {isFacebook && url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-medium text-blue-600 hover:underline">View public profile</a>
      : isFacebook && links ? <a href={links.pageMessengerUrl} target="_blank" rel="noopener noreferrer" title="Opens this Page in Messenger, not this customer's public profile" className="text-[10px] font-medium text-slate-500 hover:underline">Open Page Messenger</a> : null}
    {notice ? <div role="status" className="absolute left-0 top-[90px] z-30 w-64 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg"><button type="button" aria-label="Dismiss profile notice" onClick={() => setNotice("")} className="float-right ml-2 px-1">×</button>{notice}</div> : null}
  </div>;
}
