/*
 * TENH automatic session bridge.
 *
 * No manual pairing UI. A signed-in app.tenhchat.com session obtains a limited
 * extension device token from TENH's same-origin backend. The web page never
 * receives that token.
 */

const ALLOWED = new Set([
  "TENH_EXTENSION_PING",
  "TENH_UNPAIR",
  "OPEN_IN_FACEBOOK",
  "OPEN_FACEBOOK_PROFILE",
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

function runtimeAvailable() {
  if (extensionContextInvalidated) return false;
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function markContextInvalidated() {
  if (extensionContextInvalidated) return;
  extensionContextInvalidated = true;

  if (realtimePortReconnectTimer) {
    clearTimeout(realtimePortReconnectTimer);
    realtimePortReconnectTimer = null;
  }
  if (retryIntervalId) {
    clearInterval(retryIntervalId);
    retryIntervalId = null;
  }

  try {
    realtimePort?.disconnect();
  } catch {
    // The old extension context is already gone.
  }
  realtimePort = null;

  try {
    window.postMessage(
      {
        source: "TENH_EXTENSION",
        type: "TENH_EXTENSION_CONTEXT_INVALIDATED",
        requiresRefresh: true,
      },
      window.location.origin,
    );
  } catch {
    // Never let an optional companion error reach TENH.
  }
}

function isContextInvalidatedError(error) {
  return /extension context invalidated/i.test(String(error?.message ?? error ?? ""));
}

function sendRuntimeMessage(message, callback) {
  if (!runtimeAvailable()) {
    markContextInvalidated();
    callback?.(null, new Error("extension_unavailable"));
    return false;
  }

  try {
    chrome.runtime.sendMessage(message, (response) => {
      let error = null;
      try {
        error = chrome.runtime.lastError ?? null;
      } catch (caught) {
        error = caught;
      }

      if (error && isContextInvalidatedError(error)) markContextInvalidated();
      callback?.(response, error);
    });
    return true;
  } catch (error) {
    if (isContextInvalidatedError(error) || !runtimeAvailable()) {
      markContextInvalidated();
    }
    callback?.(null, error);
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

let realtimePort = null;
let realtimePortReconnectTimer = null;

function connectRealtimePort() {
  if (realtimePort) return realtimePort;
  if (!runtimeAvailable()) {
    markContextInvalidated();
    return null;
  }
  try {
    const port = chrome.runtime.connect({ name: "TENH_REALTIME_BRIDGE" });
    realtimePort = port;

    port.onMessage.addListener((message) => {
      if (message?.type === "TENH_SYNC_PUSH") {
        window.postMessage(
          { source: "TENH_EXTENSION", type: "TENH_SYNC_PUSH", event: safeEvent(message.event) },
          window.location.origin,
        );
        return;
      }

      if (message?.type === "TENH_SYNC_ACK") {
        window.postMessage(
          {
            source: "TENH_EXTENSION",
            type: "TENH_SYNC_ACK",
            eventId: message.eventId ?? null,
            cursor: message.cursor ?? null,
            at: Number(message.at ?? Date.now()),
          },
          window.location.origin,
        );
      }
    });

    port.onDisconnect.addListener(() => {
      realtimePort = null;
      if (realtimePortReconnectTimer) clearTimeout(realtimePortReconnectTimer);
      if (extensionContextInvalidated) return;
      realtimePortReconnectTimer = setTimeout(() => {
        realtimePortReconnectTimer = null;
        if (!extensionContextInvalidated) connectRealtimePort();
      }, 1000);
    });

    return port;
  } catch (error) {
    if (isContextInvalidatedError(error) || !runtimeAvailable()) {
      markContextInvalidated();
    }
    return null;
  }
}

connectRealtimePort();

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;

  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.source !== "TENH_WEB") return;
  if (typeof data.type !== "string" || !ALLOWED.has(data.type)) return;

  const requestId = typeof data.requestId === "string" ? data.requestId : null;
  const outgoing = {
    type: data.type,
    pageId: typeof data.pageId === "string" ? data.pageId : undefined,
    threadId: typeof data.threadId === "string" ? data.threadId : undefined,
    conversationId:
      typeof data.conversationId === "string" ? data.conversationId : undefined,
    customerName:
      typeof data.customerName === "string" ? data.customerName.slice(0, 200) : undefined,
  };

  if (data.type === "TENH_WEB_SYNC_EVENT") {
    outgoing.event = safeEvent(data.event);
    const port = connectRealtimePort();
    if (port && outgoing.event) {
      try {
        port.postMessage(outgoing);
        window.postMessage(
          {
            source: "TENH_EXTENSION",
            type: "TENH_WEB_SYNC_EVENT_RESULT",
            requestId,
            accepted: true,
            queuedForRealtime: true,
          },
          window.location.origin,
        );
        return;
      } catch {
        /* Fall through to one-shot messaging. */
      }
    }
  }

  sendRuntimeMessage(outgoing, (response, error) => {
    const payload = error ? { error: "extension_unavailable" } : (response ?? {});

    window.postMessage(
      {
        source: "TENH_EXTENSION",
        type:
          data.type === "TENH_EXTENSION_PING"
            ? "TENH_EXTENSION_PONG"
            : `${data.type}_RESULT`,
        requestId,
        ...payload,
      },
      window.location.origin,
    );
  });
});

/* Receive safe high-level sync notifications from the service worker. The
 * website can choose to refresh its normal source-of-truth data; the extension
 * does not inject message/customer payloads into page state. */
try {
  if (runtimeAvailable()) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== "TENH_SYNC_PUSH") return false;

      window.postMessage(
        {
          source: "TENH_EXTENSION",
          type: "TENH_SYNC_PUSH",
          event: safeEvent(message.event),
        },
        window.location.origin,
      );

      return false;
    });
  }
} catch (error) {
  if (isContextInvalidatedError(error)) markContextInvalidated();
}

/* ------------------------------------------------ automatic connection */

let connecting = false;
let lastAttemptAt = 0;
const RETRY_MS = 30_000;

function worker(message) {
  return new Promise((resolve) => {
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

    await worker({
      type: "TENH_AUTO_CONNECTED",
      token: result.token,
      device: result.device ?? null,
    });
  } catch {
    /* Optional layer. Normal TENH continues. */
  } finally {
    connecting = false;
  }
}

void connectIfSignedIn({ force: true });

window.addEventListener("focus", () => {
  void connectIfSignedIn({ force: true });
});

window.addEventListener("online", () => {
  void connectIfSignedIn({ force: true });
  void worker({ type: "TENH_SYNC_NOW" });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void connectIfSignedIn({ force: true });
    void worker({ type: "TENH_SYNC_NOW" });
  }
});

retryIntervalId = setInterval(() => {
  if (!extensionContextInvalidated) void connectIfSignedIn();
}, RETRY_MS);

window.postMessage(
  {
    source: "TENH_EXTENSION",
    type: "TENH_EXTENSION_READY",
    version: EXTENSION_VERSION,
  },
  window.location.origin,
);
