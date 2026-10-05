"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { normalizeBusinessSuiteConversationLink } from "@/lib/facebook/conversation-link";
import { facebookConversationNavigationError } from "@/lib/facebook/conversation-navigation-error";
import { readNavigationDiagnostics, providerLinkStates, providerRouteKinds, directLinkRejectReasons, type NavigationDiagnostics } from "@/lib/facebook/conversation-navigation-diagnostics";
import { useCompanion } from "@/lib/extension/use-companion";
import { verifiedConversationOpened, verifiedConversationVersionSupported, VERIFIED_CONVERSATION_MIN_VERSION } from "@/lib/extension/verified-conversation";
import { readNavigationFailure, navigationFailureNotice, navigationFailureReasons, navigationFailurePhases, type NavigationFailure } from "@/lib/extension/conversation-navigation-failure";

type Props = { pageId: string | null; threadId: string | null; conversationId: string; businessId: string; compact?: boolean; menu?: boolean; navigationOnly?: boolean };
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

// Direct Suite navigation stays independent of the optional extension fallback.
function useFacebookConversationAction({ pageId, threadId, conversationId, businessId, navigationOnly = false }: Props) {
  const companion = useCompanion();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState("");
  const [pageFallback, setPageFallback] = useState(false);
  const [lookupDetails, setLookupDetails] = useState<LookupDetails | null>(null);
  const [navigationDetails, setNavigationDetails] = useState<Partial<NavigationDiagnostics> | null>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const [legacyFallback, setLegacyFallback] = useState(false);
  const [extensionFailure, setExtensionFailure] = useState<NavigationFailure | null>(null);
  const key = JSON.stringify([businessId, conversationId, pageId, threadId]);
  const current = useRef(key); current.current = key;
  const pending = useRef<Pending | null>(null);
  useEffect(() => {
    setBusy(false); setNotice(""); setFallbackUrl(""); setPageFallback(false);
    setLookupDetails(null); setNavigationDetails(null); setCopyNotice("");
    setLegacyFallback(false);
    setExtensionFailure(null);
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
    const refresh = !navigationOnly && Boolean(notice) && !lookupDetails;
    setBusy(true); setNotice(""); setFallbackUrl(""); setPageFallback(false); setNavigationDetails(null); setLegacyFallback(false); setExtensionFailure(null);
    const timer = setTimeout(() => operation.controller.abort(), 15000);
    try {
      const params = new URLSearchParams({ businessId, pageId, recipientId: threadId });
      if (navigationOnly) params.set("lookup", "navigation");
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
      setNavigationDetails(navigationOnly && matchesContext ? readNavigationDiagnostics(result) : null);
      if (!navigationOnly && matchesContext && result.threadLookupSucceeded === true && result.threadIdSource === "meta_conversations_api" &&
          typeof result.thread_id === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(result.thread_id)) {
        setLookupDetails({ conversationId, businessId, pageId, recipientId: threadId, thread_id: result.thread_id,
          threadIdSource: result.threadIdSource, metaConversationLink: typeof result.metaConversationLink === "string" ? result.metaConversationLink : null,
          cacheUsed: result.cacheUsed === true });
        setCopyNotice("");
      } else setLookupDetails(null);
      if (!response.ok || result.success !== true) throw new Error(navigationOnly
        ? facebookConversationNavigationError(result.reason, response.status)
        : typeof result.error === "string" ? result.error.slice(0, 300) : "Unable to get this conversation's Facebook link. Please try again.");
      if (navigationOnly && matchesContext && result.navigationAvailable === false) {
        const expected = `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(pageId)}`;
        if (result.pageInboxUrl !== expected) throw new Error("The Page inbox destination could not be verified.");
        setFallbackUrl(expected); setPageFallback(true);
        const diagnostics = readNavigationDiagnostics(result);
        setLegacyFallback(result.reason === "facebook_direct_link_required" &&
          diagnostics?.providerLinkState === "retained" && diagnostics.providerRouteKind === "legacy_page_inbox" &&
          diagnostics.directLinkRejectReason === "legacy_page_inbox_route");
        setNotice(facebookConversationNavigationError(result.reason, response.status));
        return;
      }
      if (result.conversationId !== conversationId || result.businessId !== businessId || result.pageId !== pageId ||
          result.recipientId !== threadId || !(navigationOnly ? ["meta_conversations_api"] : ["meta_conversations_api", "agent_saved_business_suite"]).includes(String(result.linkSource))) throw new Error("The selected conversation changed. Reopen it and try again.");
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
  const canVerifyWithExtension = navigationOnly && legacyFallback && pageFallback && companion.verifiedConversationNavigation;
  const needsExtensionUpdate = navigationOnly && legacyFallback && Boolean(companion.installed && companion.version && !verifiedConversationVersionSupported(companion.version));
  async function verifyWithExtension() {
    if (pending.current || !canVerifyWithExtension || !pageId || !threadId) return;
    const operation: Pending = { key, controller: new AbortController(), popup: null, navigated: false };
    pending.current = operation; setBusy(true); setExtensionFailure(null);
    const timer = setTimeout(() => operation.controller.abort(), 45000);
    try {
      const result = await companion.openVerifiedConversation({ businessId, conversationId, pageId, threadId }, operation.controller.signal,
        () => current.current === key && pending.current === operation);
      if (current.current !== key || pending.current !== operation || operation.controller.signal.aborted) return;
      if (verifiedConversationOpened(result, { businessId, conversationId, pageId, threadId })) {
        setNotice(""); setFallbackUrl(""); setPageFallback(false); setLegacyFallback(false); setExtensionFailure(null);
      } else {
        const details = readNavigationFailure(result, "prepare");
        setExtensionFailure(details); setNotice(navigationFailureNotice(details));
      }
    } catch {
      if (current.current === key && pending.current === operation) {
        const details = readNavigationFailure(null, "prepare", "extension_request_failed");
        setExtensionFailure(details); setNotice(navigationFailureNotice(details));
      }
    } finally {
      clearTimeout(timer);
      operation.controller.abort();
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
  return {key,busy,notice,fallbackUrl,pageFallback,lookupDetails,navigationDetails,extensionFailure,copyNotice,open,canVerifyWithExtension,needsExtensionUpdate,verifyWithExtension,copyLookupDetails,setNotice,setFallbackUrl};
}
const FacebookActionContext = createContext<ReturnType<typeof useFacebookConversationAction>|null>(null);
export function FacebookConversationActionProvider({children,...props}: Props & {children:ReactNode}) {
  const action=useFacebookConversationAction(props);
  return <FacebookActionContext.Provider value={action}>{children}</FacebookActionContext.Provider>;
}
export function CompanionFacebookAction(props:Props) {
  const shared=useContext(FacebookActionContext);
  const key=JSON.stringify([props.businessId,props.conversationId,props.pageId,props.threadId]);
  return shared?.key===key ? <FacebookActionButton {...props} action={shared}/> : <StandaloneFacebookAction {...props}/>;
}
function StandaloneFacebookAction(props:Props) {
  const action=useFacebookConversationAction(props);
  return <FacebookActionButton {...props} action={action}/>;
}
function FacebookActionButton({compact=false,menu=false,navigationOnly=false,action}:Props & {action:ReturnType<typeof useFacebookConversationAction>}) {
  const {busy,notice,fallbackUrl,pageFallback,lookupDetails,navigationDetails,extensionFailure,copyNotice,open,canVerifyWithExtension,needsExtensionUpdate,verifyWithExtension,copyLookupDetails,setNotice,setFallbackUrl}=action;
  const label = busy ? "Opening customer conversation…" : navigationOnly ? "View conversation" : menu ? "View this conversation" : "Open in Meta Business Suite";
  return <div className={compact ? "relative shrink-0" : menu ? "" : "mt-2"}>
    <button type="button" disabled={busy} onClick={() => void open()} title={label} aria-label={label}
      className={menu ? "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50" : compact
        ? `flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-[0_4px_12px_rgba(15,23,42,0.07)] transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50 ${navigationOnly ? "lg:w-auto lg:gap-2 lg:px-3" : ""}`
        : "inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"}>
      <ExternalLink className={compact ? "h-[18px] w-[18px]" : menu ? "h-4 w-4 text-slate-400" : "h-3.5 w-3.5"} aria-hidden="true" />{compact ? navigationOnly ? <span className="hidden whitespace-nowrap text-xs font-semibold lg:inline">View conversation</span> : null : label}
    </button>
    {notice ? <div className={compact ? "absolute right-0 top-12 z-50 w-80 max-w-[85vw] rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-lg" : "mt-2 max-w-lg"}>
      {notice ? <p role="alert" className="text-xs leading-5 text-amber-900">{notice}</p> : null}
      {fallbackUrl ? <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold underline">{pageFallback ? "Open Page inbox" : "Open Facebook conversation"}</a> : null}
      {canVerifyWithExtension ? <button type="button" disabled={busy} onClick={() => void verifyWithExtension()}
        className="mt-2 block text-xs font-semibold underline disabled:opacity-50">Verify and open with TENH Extension</button> : null}
      {needsExtensionUpdate ? <p className="mt-2 text-xs text-amber-900">Update TENH Extension to {VERIFIED_CONVERSATION_MIN_VERSION} to verify this conversation.</p> : null}
      {navigationOnly && navigationDetails ? <details className="mt-2 rounded-lg border border-amber-200 p-2 text-xs text-slate-700">
        <summary className="cursor-pointer font-semibold focus-visible:outline-2 focus-visible:outline-offset-2">Show details</summary>
        <dl className="mt-2 space-y-1">
          {navigationDetails.providerLinkState ? <div><dt className="font-semibold">Provider link</dt><dd>{providerLinkStates[navigationDetails.providerLinkState]}</dd></div> : null}
          {navigationDetails.providerRouteKind ? <div><dt className="font-semibold">Provider route</dt><dd>{providerRouteKinds[navigationDetails.providerRouteKind]}</dd></div> : null}
          {navigationDetails.directLinkRejectReason ? <div><dt className="font-semibold">Direct opening</dt><dd>{directLinkRejectReasons[navigationDetails.directLinkRejectReason]}</dd></div> : null}
          {typeof navigationDetails.cacheUsed === "boolean" ? <div><dt className="font-semibold">Lookup</dt><dd>{navigationDetails.cacheUsed ? "Cached result" : "Fresh lookup"}</dd></div> : null}
          {extensionFailure ? <>
            <div><dt className="font-semibold">Extension step</dt><dd>{navigationFailurePhases[extensionFailure.phase]}</dd></div>
            <div><dt className="font-semibold">Extension result</dt><dd>{navigationFailureReasons[extensionFailure.verificationReason ?? extensionFailure.reason]}</dd></div>
            <div><dt className="font-semibold">Facebook tab</dt><dd>{extensionFailure.opened ? extensionFailure.temporaryTabClosed ? "Temporary tab closed after verification failed" : "Opened; customer was not verified" : "Not brought forward by TENH"}</dd></div>
            {extensionFailure.focusReturned ? <div><dt className="font-semibold">Focus</dt><dd>Returned to TENH</dd></div> : null}
            {typeof extensionFailure.diagnostics.dom.composerFound === "boolean" ? <div><dt className="font-semibold">Chat message box</dt><dd>{extensionFailure.diagnostics.dom.composerFound ? "Visible" : "Not visible"}</dd></div> : null}
            {typeof extensionFailure.diagnostics.dom.matchingHeaders === "number" ? <div><dt className="font-semibold">Matching chat headers</dt><dd>{extensionFailure.diagnostics.dom.matchingHeaders}</dd></div> : null}
          </> : null}
        </dl>
      </details> : null}
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
