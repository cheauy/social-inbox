(() => {
const bridgeVersion = chrome.runtime.getManifest().version;
if (globalThis.__tenh_tenh_bridge === bridgeVersion) return;
globalThis.__tenh_tenh_bridge = bridgeVersion;
/*
 * TENH automatic session bridge.
 *
 * No manual pairing UI. A signed-in app.tenhchat.com session obtains a limited
 * extension device token from TENH's same-origin backend. The web page never
 * receives that token.
 *
 * IMPORTANT: content scripts survive in an already-open page when an unpacked
 * extension is reloaded/updated. Chrome invalidates that old script's extension
 * context. Every runtime call in this file therefore goes through guarded helpers.
 * The page bridge intentionally does NOT keep a persistent runtime Port open;
 * realtime is owned by the service worker, which avoids stale Port disconnect
 * callbacks after extension reloads.
 */

const ALLOWED = new Set([
  "TENH_EXTENSION_PING",
  "TENH_UNPAIR",
  "OPEN_IN_FACEBOOK",
  "OPEN_FACEBOOK_PROFILE",
  "OPEN_RESOLVED_FACEBOOK_PROFILE",
  "CHECK_FACEBOOK_REPLY_AVAILABILITY",
  "TENH_SYNC_NOW",
  "TENH_WEB_SYNC_EVENT",
]);

const EXTENSION_VERSION = (() => {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "unknown";
  }
})();

let extensionContextInvalidated = false;
let retryIntervalId = null;

function isContextInvalidatedError(error) {
  return /extension context invalidated|context invalidated|receiving end does not exist/i.test(
    String(error?.message ?? error ?? ""),
  );
}

/* A stale content script can receive a rejected extension API Promise at the
 * exact moment Chrome reloads the extension. Suppress only that known Chrome
 * lifecycle rejection; all unrelated Promise errors remain visible. */
window.addEventListener("unhandledrejection", (event) => {
  if (!isContextInvalidatedError(event.reason)) return;
  event.preventDefault();
  markContextInvalidated();
});

function runtimeAvailable() {
  if (extensionContextInvalidated) return false;
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function safePostMessage(payload) {
  try {
    window.postMessage(payload, window.location.origin);
  } catch {
    // Optional companion layer must never break TENH.
  }
}

function markContextInvalidated() {
  if (extensionContextInvalidated) return;
  extensionContextInvalidated = true;

  if (retryIntervalId) {
    clearInterval(retryIntervalId);
    retryIntervalId = null;
  }

  safePostMessage({
    source: "TENH_EXTENSION",
    type: "TENH_EXTENSION_CONTEXT_INVALIDATED",
    requiresRefresh: true,
  });
}

function getRuntimeLastError() {
  try {
    return chrome?.runtime?.lastError ?? null;
  } catch (error) {
    return error;
  }
}

function sendRuntimeMessage(message, callback) {
  if (!runtimeAvailable()) {
    markContextInvalidated();
    callback?.(null, new Error("extension_unavailable"));
    return false;
  }

  let finished = false;
  const finish = (response, error) => {
    if (finished) return;
    finished = true;
    if (error && isContextInvalidatedError(error)) markContextInvalidated();
    try {
      callback?.(response, error);
    } catch {
      // Never let an optional callback escape into the page.
    }
  };

  try {
    /* Chrome MV3 may expose sendMessage as a Promise-capable API even when a
       callback is supplied. An invalidated content-script context can reject
       that returned Promise separately from runtime.lastError. Always attach a
       rejection handler so Chrome never records an uncaught Promise. */
    const pending = chrome.runtime.sendMessage(message, (response) => {
      finish(response, getRuntimeLastError());
    });

    if (pending && typeof pending.then === "function") {
      Promise.resolve(pending).then(
        (response) => finish(response, null),
        (error) => finish(null, error),
      );
    }

    return true;
  } catch (error) {
    if (isContextInvalidatedError(error) || !runtimeAvailable()) {
      markContextInvalidated();
    }
    finish(null, error);
    return false;
  }
}

function safeEvent(value) {
  if (!value || typeof value !== "object") return null;
  return {
    type: typeof value.type === "string" ? value.type.slice(0, 80) : "tenh.updated",
    eventId:
      typeof value.eventId === "string"
        ? value.eventId.slice(0, 160)
        : typeof value.id === "string"
          ? value.id.slice(0, 160)
          : null,
    cursor:
      typeof value.cursor === "string" || typeof value.cursor === "number"
        ? value.cursor
        : null,
    at: Number.isFinite(Number(value.at)) ? Number(value.at) : Date.now(),
    pageId: typeof value.pageId === "string" ? value.pageId.slice(0, 160) : null,
    conversationId:
      typeof value.conversationId === "string" ? value.conversationId.slice(0, 200) : null,
    fingerprint:
      typeof value.fingerprint === "string" ? value.fingerprint.slice(0, 128) : null,
    confirmed: value.confirmed === true,
  };
}

/* Realtime transport note:
 * Do not keep a chrome.runtime Port open from the page content script.
 * Chrome invalidates old content-script contexts when an extension is reloaded,
 * and a stale Port can surface an uncaught "Extension context invalidated" error.
 * TENH realtime remains active in the service worker (WebSocket/delta sync), while
 * page-to-extension events use guarded one-shot messages and server pushes return
 * through chrome.tabs.sendMessage -> chrome.runtime.onMessage below.
 */

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;

  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.source !== "TENH_WEB") return;
  if (typeof data.type !== "string" || !ALLOWED.has(data.type)) return;

  const requestId = typeof data.requestId === "string" ? data.requestId : null;

  if (extensionContextInvalidated || !runtimeAvailable()) {
    markContextInvalidated();
    safePostMessage({
      source: "TENH_EXTENSION",
      type:
        data.type === "TENH_EXTENSION_PING"
          ? "TENH_EXTENSION_PONG"
          : `${data.type}_RESULT`,
      requestId,
      error: "extension_unavailable",
      requiresRefresh: true,
    });
    return;
  }

  const outgoing = {
    type: data.type,
    pageId: typeof data.pageId === "string" ? data.pageId : undefined,
    threadId: typeof data.threadId === "string" ? data.threadId : undefined,
    conversationId:
      typeof data.conversationId === "string" ? data.conversationId : undefined,
    customerName:
      typeof data.customerName === "string" ? data.customerName.slice(0, 200) : undefined,
    openToken: typeof data.openToken === "string" ? data.openToken.slice(0, 100) : undefined,
  };

  if (data.type === "TENH_WEB_SYNC_EVENT") {
    outgoing.event = safeEvent(data.event);
    if (!outgoing.event) {
      safePostMessage({
        source: "TENH_EXTENSION",
        type: "TENH_WEB_SYNC_EVENT_RESULT",
        requestId,
        accepted: false,
        error: "invalid_event",
      });
      return;
    }
  }

  sendRuntimeMessage(outgoing, (response, error) => {
    const payload = error ? { error: "extension_unavailable" } : (response ?? {});
    safePostMessage({
      source: "TENH_EXTENSION",
      type:
        data.type === "TENH_EXTENSION_PING"
          ? "TENH_EXTENSION_PONG"
          : `${data.type}_RESULT`,
      requestId,
      ...payload,
    });
  });
});

/* Receive safe high-level sync notifications from the service worker. */
try {
  if (runtimeAvailable()) {
    chrome.runtime.onMessage.addListener((message) => {
      if (extensionContextInvalidated) return false;
      if (message?.type !== "TENH_SYNC_PUSH") return false;

      safePostMessage({
        source: "TENH_EXTENSION",
        type: "TENH_SYNC_PUSH",
        event: safeEvent(message.event),
      });
      return false;
    });
  }
} catch (error) {
  if (isContextInvalidatedError(error) || !runtimeAvailable()) {
    markContextInvalidated();
  }
}

/* ------------------------------------------------ automatic connection */

let connecting = false;
let lastAttemptAt = 0;
const RETRY_MS = 30_000;

function worker(message) {
  return new Promise((resolve) => {
    if (extensionContextInvalidated || !runtimeAvailable()) {
      markContextInvalidated();
      resolve({ error: "extension_unavailable" });
      return;
    }

    sendRuntimeMessage(message, (response, error) => {
      resolve(error ? { error: "extension_unavailable" } : (response ?? {}));
    });
  });
}

async function connectIfSignedIn({ force = false } = {}) {
  if (extensionContextInvalidated) return;
  if (!runtimeAvailable()) {
    markContextInvalidated();
    return;
  }
  if (connecting) return;

  const now = Date.now();
  if (!force && now - lastAttemptAt < 2000) return;

  connecting = true;
  lastAttemptAt = now;

  try {
    const state = await worker({ type: "TENH_CONNECTION_STATE" });
    if (state?.error === "extension_unavailable") return;
    if (state?.connected === true || state?.paired === true) return;
    if (!state?.installationId) return;

    const response = await fetch("/api/extension/auto-pair", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        browserInstallationId: state.installationId,
        deviceName: state.deviceName,
        extensionVersion: EXTENSION_VERSION,
      }),
    });

    let result = null;
    try {
      result = await response.json();
    } catch {
      result = null;
    }

    if (!response.ok || !result?.success || !result.token) return;
    if (extensionContextInvalidated || !runtimeAvailable()) return;

    await worker({
      type: "TENH_AUTO_CONNECTED",
      token: result.token,
      device: result.device ?? null,
    });
  } catch {
    // Optional layer. Normal TENH continues.
  } finally {
    connecting = false;
  }
}

void connectIfSignedIn({ force: true });

window.addEventListener("focus", () => {
  if (!extensionContextInvalidated) void connectIfSignedIn({ force: true });
});

window.addEventListener("online", () => {
  if (extensionContextInvalidated) return;
  void connectIfSignedIn({ force: true });
  void worker({ type: "TENH_SYNC_NOW" });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !extensionContextInvalidated) {
    void connectIfSignedIn({ force: true });
    void worker({ type: "TENH_SYNC_NOW" });
  }
});

retryIntervalId = setInterval(() => {
  if (!extensionContextInvalidated) void connectIfSignedIn();
}, RETRY_MS);

safePostMessage({
  source: "TENH_EXTENSION",
  type: "TENH_EXTENSION_READY",
  version: EXTENSION_VERSION,
});

})();
