"use client";
import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { normalizeBusinessSuiteConversationLink } from "@/lib/facebook/conversation-link";

type Props = { pageId: string | null; threadId: string | null; conversationId: string; businessId: string; compact?: boolean; menu?: boolean };
type Pending = { key: string; controller: AbortController; popup: Window | null; navigated: boolean };
type LookupDetails = { conversationId: string; businessId: string; pageId: string; recipientId: string;
  thread_id: string; threadIdSource: string; metaConversationLink: string | null; cacheUsed: boolean };
function loadingWindow(popup: Window | null) {
  try { return popup && !popup.closed && popup.location.href === "about:blank" ? popup : null; }
  catch { return null; }
}
function closeLoadingWindow(pending: Pending) {
  if (!pending.navigated) loadingWindow(pending.popup)?.close();
}

// Keep the exported name for existing callers; this action has no extension dependency.
export function CompanionFacebookAction({ pageId, threadId, conversationId, businessId, compact = false, menu = false }: Props) {
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState("");
  const [lookupDetails, setLookupDetails] = useState<LookupDetails | null>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const key = JSON.stringify([businessId, conversationId, pageId, threadId]);
  const current = useRef(key); current.current = key;
  const pending = useRef<Pending | null>(null);
  useEffect(() => {
    setBusy(false); setNotice(""); setFallbackUrl("");
    setLookupDetails(null); setCopyNotice("");
    return () => {
      const operation = pending.current;
      if (operation?.key === key) {
        operation.controller.abort(); closeLoadingWindow(operation); pending.current = null;
      }
    };
  }, [key]);

  async function open() {
    if (pending.current) return;
    if (!pageId || !threadId) { setNotice("The Facebook Page/customer ID is unavailable for this conversation."); return; }
    const operation: Pending = { key, controller: new AbortController(), popup: null, navigated: false };
    pending.current = operation;
    // Open synchronously with the click so a slow API request does not lose
    // browser user activation. Only our untouched blank window may be closed.
    try {
      operation.popup = window.open("about:blank", "_blank");
      if (operation.popup) {
        operation.popup.opener = null;
        operation.popup.document.title = "Opening Facebook conversation";
        const message = operation.popup.document.createElement("p");
        message.textContent = "Opening your Facebook conversation…";
        message.style.cssText = "font:16px system-ui;padding:24px;color:#334155";
        operation.popup.document.body.appendChild(message);
      }
    } catch { closeLoadingWindow(operation); operation.popup = null; }
    // A missing Suite link does not invalidate a successfully resolved Graph
    // thread. Reuse that cache; only retry a failed lookup with a refresh.
    const refresh = Boolean(notice) && !lookupDetails;
    setBusy(true); setNotice(""); setFallbackUrl("");
    const timer = setTimeout(() => operation.controller.abort(), 15000);
    try {
      const params = new URLSearchParams({ businessId, pageId, recipientId: threadId });
      if (refresh) params.set("refresh", "1");
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/facebook-conversation?${params}`, {
        credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }, signal: operation.controller.signal,
      });
      let result: Record<string, unknown>;
      try {
        const body = await response.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
        result = body;
      } catch { throw new Error("TENH returned an unexpected response. Refresh TENH and try again."); }
      if (pending.current !== operation || current.current !== key) return;
      if (operation.controller.signal.aborted) throw new Error("Request timed out.");
      const matchesContext = result.conversationId === conversationId && result.businessId === businessId &&
        result.pageId === pageId && result.recipientId === threadId;
      if (matchesContext && result.threadLookupSucceeded === true && result.threadIdSource === "meta_conversations_api" &&
          typeof result.thread_id === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(result.thread_id)) {
        setLookupDetails({ conversationId, businessId, pageId, recipientId: threadId, thread_id: result.thread_id,
          threadIdSource: result.threadIdSource, metaConversationLink: typeof result.metaConversationLink === "string" ? result.metaConversationLink : null,
          cacheUsed: result.cacheUsed === true });
        setCopyNotice("");
      } else setLookupDetails(null);
      if (!response.ok || result.success !== true) throw new Error(typeof result.error === "string" ? result.error.slice(0, 300) : "Unable to get this conversation's Facebook link. Please try again.");
      if (result.conversationId !== conversationId || result.businessId !== businessId || result.pageId !== pageId ||
          result.recipientId !== threadId || !["meta_conversations_api", "agent_saved_business_suite"].includes(String(result.linkSource))) throw new Error("The selected conversation changed. Reopen it and try again.");
      const link = normalizeBusinessSuiteConversationLink(result.conversationLink, pageId, threadId);
      if (!link) throw new Error("Direct opening in Business Suite is unavailable for this chat.");
      const popup = loadingWindow(operation.popup);
      if (popup) {
        popup.location.replace(link); operation.navigated = true;
      } else {
        setFallbackUrl(link); setNotice("Your Facebook conversation link is ready. Click below to open it.");
      }
    } catch (error) {
      if (pending.current === operation && current.current === key) {
        setNotice(operation.controller.signal.aborted ? "The request took too long. Please try again." : error instanceof Error ? error.message : "Unable to open this conversation. Please try again.");
      }
    } finally {
      clearTimeout(timer); closeLoadingWindow(operation);
      if (pending.current === operation) { pending.current = null; setBusy(false); }
    }
  }
  async function copyLookupDetails() {
    if (!lookupDetails) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(lookupDetails, null, 2));
      if (current.current === key) setCopyNotice("Copied");
    } catch { if (current.current === key) setCopyNotice("Select and copy the details below."); }
  }
  const label = busy ? "Opening customer conversation…" : menu ? "View this conversation" : "Open in Meta Business Suite";
  return <div className={compact ? "relative shrink-0" : menu ? "" : "mt-2"}>
    <button type="button" disabled={busy} onClick={() => void open()} title={label} aria-label={label}
      className={menu ? "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50" : compact
        ? "flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-[0_4px_12px_rgba(15,23,42,0.07)] transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50"
        : "inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"}>
      <ExternalLink className={compact ? "h-[18px] w-[18px]" : menu ? "h-4 w-4 text-slate-400" : "h-3.5 w-3.5"} aria-hidden="true" />{compact ? null : label}
    </button>
    {notice ? <div className={compact ? "absolute right-0 top-12 z-50 w-80 max-w-[85vw] rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-lg" : "mt-2 max-w-lg"}>
      {notice ? <p role="alert" className="text-xs leading-5 text-amber-900">{notice}</p> : null}
      {fallbackUrl ? <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold underline">Open Facebook conversation</a> : null}
      {lookupDetails ? <details className="mt-2 text-xs text-slate-600">
        <summary className="cursor-pointer">Meta lookup details</summary>
        <p className="mt-2">Meta found the thread. Its ID alone does not verify a Business Suite destination.</p>
        <button type="button" onClick={() => void copyLookupDetails()} className="my-2 font-semibold underline">Copy lookup details</button>
        {copyNotice ? <span role="status" className="ml-2">{copyNotice}</span> : null}
        <pre className="max-h-40 select-text overflow-auto rounded-lg border border-slate-200 bg-white p-2">{JSON.stringify(lookupDetails, null, 2)}</pre>
      </details> : null}
      {compact ? <button type="button" onClick={() => { setNotice(""); setFallbackUrl(""); }} className="mt-2 text-xs font-semibold text-slate-600">Dismiss</button> : null}
    </div> : null}
  </div>;
}
