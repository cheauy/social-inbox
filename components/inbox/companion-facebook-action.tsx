"use client";
import { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useCompanion } from "@/lib/extension/use-companion";
import { TENH_EXTENSION_STORE_URL } from "@/lib/extension/store-listing";
type Props = { pageId: string | null; threadId: string | null; conversationId: string; businessId: string };
export function CompanionFacebookAction({ pageId, threadId, conversationId, businessId }: Props) {
  const { installed, openInFacebook } = useCompanion();
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const lock = useRef(false); const current = useRef(conversationId); current.current = conversationId;
  async function open() {
    if (lock.current) return;
    if (!installed) { setNotice("Install or enable TENH Companion first, then refresh TENH to open this customer's conversation in Meta Business Suite."); return; }
    if (!pageId || !threadId) { setNotice("The Facebook Page/customer ID is unavailable for this conversation."); return; }
    const requested = conversationId; lock.current = true; setBusy(true); setNotice("");
    try {
      const opened = await openInFacebook({ pageId, threadId, conversationId, businessId });
      if (!opened && current.current === requested) setNotice("Could not open this conversation. Check TENH Companion is connected, update it to 1.2.21, and refresh TENH.");
    } catch { if (current.current === requested) setNotice("TENH Companion is unavailable. Refresh TENH and try again."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="mt-2">
    <button type="button" disabled={busy} onClick={() => void open()} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{busy ? "Opening customer conversation…" : "Open in Meta Business Suite"}</button>
    {notice ? <p role="alert" className="mt-2 max-w-lg text-xs leading-5 text-amber-900">{notice}</p> : null}
    {notice && !installed && TENH_EXTENSION_STORE_URL ? <a href={TENH_EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold underline">Install TENH Companion</a> : null}
  </div>;
}
