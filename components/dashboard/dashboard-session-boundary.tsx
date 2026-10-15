"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { createClient } from "@/lib/supabase/client";
import { broadcastSessionEnd, clearBrowserSession, currentBrowserAuthState, currentBrowserSessionId, reloadForSessionChange, resumeBrowserSession, SESSION_BROADCAST_CHANNEL, SESSION_END_EVENT, suspendPrivateSession } from "@/lib/auth/browser-session";

type State = "checking" | "valid" | "unavailable" | "expired" | "signing-out";

export function DashboardSessionBoundary({ children, initialSessionId, initialUserId }: { children: ReactNode; initialSessionId?: string | null; initialUserId?: string | null }) {
  const language = useWorkspaceLanguageId();
  const t = (en: string, km: string) => language === "km" ? km : en;
  const [state, setState] = useState<State>("checking");
  const retry = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false, ended = false, checking = false, failures = 0, epoch = 0;
    let timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | null = null;
    let verifiedSessionId: string | null = initialSessionId ?? null, visible = false, suspended = false;
    function hide() { if (!suspended) { suspendPrivateSession(); suspended = true; } visible = false; }
    function matches(sessionId: unknown) {
      const current = currentBrowserSessionId() ?? verifiedSessionId;
      return typeof sessionId === "string" && current === sessionId;
    }
    function finish(sessionId: string | null, notify: boolean, expectedAuthState?: string) {
      if (disposed || ended) return;
      const current = currentBrowserSessionId();
      if (sessionId && current && current !== sessionId) { void validate(); return; }
      if (!clearBrowserSession(sessionId, expectedAuthState)) { void validate(); return; }
      ended = true; epoch++; controller?.abort(); clearTimeout(timer);
      visible = false; setState("expired");
      if (notify) broadcastSessionEnd("expired", sessionId);
    }
    async function validate() {
      if (disposed || ended || checking) return;
      checking = true; clearTimeout(timer);
      const requestEpoch = ++epoch, requestSessionId = currentBrowserSessionId() ?? verifiedSessionId;
      const requestAuthState = currentBrowserAuthState();
      const requestController = new AbortController(); controller = requestController;
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; requestController.abort(); }, 10_000);
      let delay = 30_000;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store", signal: requestController.signal });
        if (disposed || ended || (requestController.signal.aborted && !timedOut) || requestEpoch !== epoch) return;
        const current = currentBrowserSessionId();
        if (current && current !== requestSessionId) { hide(); setState("checking"); delay = 0; return; }
        if ((response.status === 401 || response.status === 403) && currentBrowserAuthState() !== requestAuthState) { hide(); setState("checking"); delay = 0; return; }
        if (response.status === 401 || response.status === 403) { finish(requestSessionId, true, requestAuthState); return; }
        const result = await response.json();
        if (disposed || ended || requestController.signal.aborted || requestEpoch !== epoch) return;
        if (currentBrowserSessionId() && currentBrowserSessionId() !== requestSessionId) { hide(); setState("checking"); delay = 0; return; }
        const hasExpiry = typeof result.expiresAt === "string" && Number.isFinite(Date.parse(result.expiresAt));
        const validPolicy = result.kind === "legacy" ? result.remembered === null && (result.expiresAt === null || hasExpiry) : hasExpiry && typeof result.remembered === "boolean";
        if (!response.ok || result.success !== true || typeof result.userId !== "string" || !result.userId || typeof result.sessionId !== "string" || !result.sessionId || !validPolicy) throw new Error("Session validation unavailable");
        if ((initialUserId && result.userId !== initialUserId) || (verifiedSessionId && result.sessionId !== verifiedSessionId)) {
          hide(); ended = true; setState("checking"); reloadForSessionChange(); return;
        }
        verifiedSessionId = result.sessionId; failures = 0;
        // Relative server time avoids trusting the browser's wall clock for expiry.
        if (hasExpiry && typeof result.serverTime === "string" && Number.isFinite(Date.parse(result.serverTime))) delay = Math.max(500, Math.min(30_000, Date.parse(result.expiresAt) - Date.parse(result.serverTime)));
        if (!visible) resumeBrowserSession();
        visible = true; suspended = false; setState("valid");
      } catch {
        if (disposed || ended || (requestController.signal.aborted && !timedOut) || requestEpoch !== epoch) return;
        hide(); setState("unavailable"); failures = Math.min(failures + 1, 6); delay = Math.min(60_000, 5_000 * 2 ** (failures - 1));
      } finally {
        clearTimeout(timeout);
        if (requestEpoch === epoch) { checking = false; if (!disposed && !ended && failures < 6) timer = setTimeout(() => void validate(), delay); }
      }
    }
    function revalidate() {
      const current = currentBrowserSessionId();
      if (verifiedSessionId && current && current !== verifiedSessionId) {
        epoch++; controller?.abort(); checking = false; hide(); setState("checking");
      }
      void validate();
    }
    function restore() { if (!disposed && !ended) { hide(); setState("checking"); revalidate(); } }
    function handleVisible() { if (!document.hidden) revalidate(); }
    function handlePageShow(event: PageTransitionEvent) { if (event.persisted) restore(); else revalidate(); }
    function handleEnd(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (!detail || (detail.sessionId && !matches(detail.sessionId))) return;
      if (detail.phase === "pending") { ended = true; epoch++; controller?.abort(); clearTimeout(timer); hide(); setState("signing-out"); }
      else { clearBrowserSession(detail.sessionId ?? verifiedSessionId); setState("expired"); }
    }
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(SESSION_BROADCAST_CHANNEL);
      channel.onmessage = event => { const message = event.data; if (message?.type === "session-ended" && matches(message.sessionId)) finish(message.sessionId, false); };
    } catch { /* Server checks remain available in browsers without BroadcastChannel. */ }
    let unsubscribe = () => {};
    try { const { data } = createClient().auth.onAuthStateChange(() => revalidate()); unsubscribe = () => data.subscription.unsubscribe(); } catch { /* The server check does not depend on browser SDK readiness. */ }
    retry.current = () => { if (!checking && !ended) { setState("checking"); void validate(); } };
    window.addEventListener("focus", revalidate); window.addEventListener("online", revalidate);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener(SESSION_END_EVENT, handleEnd); document.addEventListener("visibilitychange", handleVisible);
    void validate();
    return () => { disposed = true; epoch++; controller?.abort(); clearTimeout(timer); channel?.close(); unsubscribe(); window.removeEventListener("focus", revalidate); window.removeEventListener("online", revalidate); window.removeEventListener("pageshow", handlePageShow); window.removeEventListener(SESSION_END_EVENT, handleEnd); document.removeEventListener("visibilitychange", handleVisible); retry.current = () => {}; };
  }, [initialSessionId, initialUserId]);

  if (state === "valid") return <>{children}</>;
  if (state === "checking") return <main aria-busy="true" className="flex min-h-dvh items-center justify-center bg-slate-100 p-6"><div role="status" aria-live="polite"><span className="sr-only">{t("Loading", "កំពុងផ្ទុក")}</span><div aria-hidden="true" className="tenh-session-loader"><div className="circle" /><div className="circle" /><div className="circle" /><div className="circle" /></div></div></main>;
  return <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-6"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
    <h1 className="text-xl font-bold text-slate-950">{state === "expired" ? t("Your session expired. Please sign in again.", "វគ្គចូលគណនីរបស់អ្នកបានផុតកំណត់។ សូមចូលម្ដងទៀត។") : state === "unavailable" ? t("Unable to validate your session.", "មិនអាចផ្ទៀងផ្ទាត់វគ្គចូលគណនីរបស់អ្នកបានទេ។") : t("Signing out…", "កំពុងចាកចេញ…")}</h1>
    {state === "unavailable" ? <><p role="alert" className="mt-3 text-sm leading-6 text-slate-600">{t("Private content is hidden while your sign-in cannot be checked. Try again.", "ខ្លឹមសារឯកជនត្រូវបានលាក់ពេលមិនអាចពិនិត្យការចូលបាន។ សូមព្យាយាមម្ដងទៀត។")}</p><button type="button" onClick={() => retry.current()} className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white">{t("Try again", "ព្យាយាមម្ដងទៀត")}</button></> : state === "expired" ? <a href="/login?expired=1" className="mt-5 inline-block rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white">{t("Sign in", "ចូលគណនី")}</a> : <p role="status" className="mt-3 text-sm text-slate-600">{t("Please wait…", "សូមរង់ចាំ…")}</p>}
  </section></main>;
}
