"use client";
import { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useCompanion } from "@/lib/extension/use-companion";
import { TENH_EXTENSION_STORE_URL } from "@/lib/extension/store-listing";
type Props = { pageId: string | null; threadId: string | null; conversationId: string; businessId: string; compact?: boolean };
export function CompanionFacebookAction({ pageId, threadId, conversationId, businessId, compact = false }: Props) {
  const { installed, openInFacebook } = useCompanion();
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const lock = useRef(false); const current = useRef(conversationId); current.current = conversationId;
  async function open() {
    if (lock.current) return;
    if (!installed) { setNotice("Install or enable TENH Companion first, then refresh TENH to open this customer's conversation in Meta Business Suite."); return; }
    if (!pageId || !threadId) { setNotice("The Facebook Page/customer ID is unavailable for this conversation."); return; }
    const requested = conversationId; lock.current = true; setBusy(true); setNotice("");
    try {
      const result = await openInFacebook({ pageId, threadId, conversationId, businessId });
      if (current.current !== requested) return;
      if (!result?.opened) setNotice("Could not open this conversation. Check TENH Companion is connected and updated, then refresh TENH.");
      else if (result.exactRequested !== true) setNotice("Facebook opened, but the exact customer chat could not be selected. Choose the customer in the Page inbox.");
    } catch { if (current.current === requested) setNotice("TENH Companion is unavailable. Refresh TENH and try again."); }
    finally { lock.current = false; setBusy(false); }
  }
  const label = busy ? "Opening customer conversation…" : "Open in Meta Business Suite";
  return <div className={compact ? "relative shrink-0" : "mt-2"}>
    <button type="button" disabled={busy} onClick={() => void open()} title={label} aria-label={label}
      className={compact
        ? "flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-[0_4px_12px_rgba(15,23,42,0.07)] transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50"
        : "inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"}>
      <ExternalLink className={compact ? "h-[18px] w-[18px]" : "h-3.5 w-3.5"} aria-hidden="true" />{compact ? null : label}
    </button>
    {notice ? <div className={compact ? "absolute right-0 top-12 z-50 w-72 max-w-[85vw] rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-lg" : "mt-2 max-w-lg"}>
      <p role="alert" className="text-xs leading-5 text-amber-900">{notice}</p>
      {!installed && TENH_EXTENSION_STORE_URL ? <a href={TENH_EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold underline">Install TENH Companion</a> : null}
      {compact ? <button type="button" onClick={() => setNotice("")} className="mt-2 text-xs font-semibold text-slate-600">Dismiss</button> : null}
    </div> : null}
  </div>;
}
