"use client";

import { createClient } from "@/lib/supabase/client";
import { readSessionCookieHint, SESSION_HINT_COOKIE } from "@/lib/auth/session-cookie-options";
import { clearWorkspaceStorageCache } from "@/lib/storage/workspace-storage-cache";

export const SESSION_END_EVENT = "tenh:session-end";
export const SESSION_BROADCAST_CHANNEL = "tenh:session-state";
export type SessionEndReason = "expired" | "logout";

export function reloadForSessionChange() { window.location.replace(window.location.href); }

export function currentBrowserSessionId() {
  try {
    const raw = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(`${SESSION_HINT_COOKIE}=`))?.slice(SESSION_HINT_COOKIE.length + 1);
    // The hint only scopes cleanup messages; the server authorizes every session.
    return readSessionCookieHint(raw ? decodeURIComponent(raw) : undefined)?.sessionId ?? null;
  } catch { return null; }
}

export function suspendPrivateSession() {
  clearWorkspaceStorageCache();
  try {
    const client = createClient();
    void Promise.resolve(client.removeAllChannels()).catch(() => {});
    void Promise.resolve(client.auth.stopAutoRefresh()).catch(() => {});
  } catch { /* Private UI and caches still clear when the SDK is unavailable. */ }
}

export function resumeBrowserSession() {
  try { void Promise.resolve(createClient().auth.startAutoRefresh()).catch(() => {}); } catch { /* Server validation remains authoritative. */ }
}

export function clearBrowserSession(expectedSessionId: string | null) {
  const current = currentBrowserSessionId();
  if (expectedSessionId && current && expectedSessionId !== current) return false;
  suspendPrivateSession();
  let project = "";
  try { project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.split(".")[0]; } catch { /* Only known application cookies are removed below. */ }
  const prefix = project ? `sb-${project}-auth-token` : null;
  const ownNames = new Set([SESSION_HINT_COOKIE, "tenh_auth_intent", "tenh_recovery_grant"]);
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.trim().split("=")[0];
    if (ownNames.has(name) || (prefix && (name === prefix || name.startsWith(`${prefix}.`) || name === `${prefix}-code-verifier` || name.startsWith(`${prefix}-code-verifier.`)))) {
      document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    }
  }
  for (const name of ["tenh_verification_email", "tenh_pending_invitation_token"]) {
    try { sessionStorage.removeItem(name); } catch { /* Storage restrictions must not keep a session visible. */ }
  }
  return true;
}

export function broadcastSessionEnd(reason: SessionEndReason, sessionId: string | null) {
  if (!sessionId) return;
  try {
    const channel = new BroadcastChannel(SESSION_BROADCAST_CHANNEL);
    channel.postMessage({ type: "session-ended", reason, sessionId });
    channel.close();
  } catch { /* Focus and server polling also validate tabs without BroadcastChannel. */ }
}

export async function signOutBrowser(scope: "local" | "global") {
  const sessionId = currentBrowserSessionId();
  window.dispatchEvent(new CustomEvent(SESSION_END_EVENT, { detail: { phase: "pending", reason: "logout", sessionId } }));
  let confirmed = false;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("/api/auth/sign-out", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }), signal: controller.signal });
    const result = await response.json();
    confirmed = response.ok && result.success === true && result.signedOutLocally === true && result.remoteRevocationConfirmed === true;
  } catch { /* The local session still ends when remote revocation cannot be confirmed. */ }
  finally { window.clearTimeout(timeout); }
  const cleared = clearBrowserSession(sessionId);
  if (cleared) {
    broadcastSessionEnd("logout", sessionId);
    window.dispatchEvent(new CustomEvent(SESSION_END_EVENT, { detail: { phase: "complete", reason: "logout", sessionId } }));
    window.location.replace(confirmed ? "/login" : "/login?logout=uncertain");
  } else reloadForSessionChange();
  return { remoteRevocationConfirmed: confirmed };
}
