/*
 * TENH v1 service worker.
 *
 * The extension is an optional accelerator around the normal TENH stack.
 * Meta webhooks/TENH/Supabase remain authoritative. Browser observations are
 * treated as hints that can be reconciled with the provider event later.
 */

const TENH_ORIGIN = "https://app.tenhchat.com";
const HEARTBEAT_ALARM = "tenh-heartbeat";
const SYNC_ALARM = "tenh-sync";
const HEARTBEAT_MINUTES = 0.5;
const SYNC_MINUTES = 1;
const VERSION = chrome.runtime.getManifest().version;

const QUEUE_KEY = "syncQueue";
const MAX_QUEUE = 120;
const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_RETRY_MS = 5 * 60 * 1000;
const MANAGED_TAB_URL = "https://business.facebook.com/latest/inbox/all";
const REALTIME_SESSION_PATH = "/api/extension/realtime/session";
const REALTIME_ACK_PATH = "/api/extension/sync/ack";
const REALTIME_UNSUPPORTED_MS = 15 * 60 * 1000;
const REALTIME_PING_MS = 20 * 1000;
const RECENT_FINGERPRINT_TTL_MS = 15 * 60 * 1000;
const MAX_RECENT_FINGERPRINTS = 120;
const MAX_FACEBOOK_TAB_STATES = 50;
const FACEBOOK_TAB_STATE_TTL_MS = 2 * 60 * 60 * 1000;

let flushPromise = null;
let deltaPromise = null;
let realtimeConnectPromise = null;
let realtimeSocket = null;
let realtimePingTimer = null;
let realtimeReconnectTimer = null;
let realtimeAttempts = 0;
const tenhRealtimePorts = new Set();

/* ---------------------------------------------------------------- storage */

async function readState() {
  const [stored, session] = await Promise.all([
    chrome.storage.local.get([
      "token",
      "device",
      "installationId",
      "facebook",
      "facebookTabs",
      "managedFacebookTabId",
      "managedFacebookWindowId",
      "keepFacebookActive",
      "syncCursor",
      "syncStatus",
      "realtimeStatus",
      "realtimeUnsupportedUntil",
      "recentFingerprints",
    ]),
    chrome.storage.session.get([QUEUE_KEY]),
  ]);

  stored[QUEUE_KEY] = Array.isArray(session[QUEUE_KEY]) ? session[QUEUE_KEY] : [];

  if (!stored.installationId) {
    stored.installationId = crypto.randomUUID();
    await chrome.storage.local.set({ installationId: stored.installationId });
  }

  if (stored.keepFacebookActive === undefined) {
    stored.keepFacebookActive = false;
    await chrome.storage.local.set({ keepFacebookActive: false });
  }

  return stored;
}

async function writeState(patch) {
  await chrome.storage.local.set(patch);
}

async function facebookTabStates() {
  const state = await readState();
  const now = Date.now();
  const raw = state.facebookTabs && typeof state.facebookTabs === "object"
    ? state.facebookTabs
    : {};
  const entries = Object.entries(raw)
    .filter(([, value]) => value && now - Number(value.seenAt ?? 0) < FACEBOOK_TAB_STATE_TTL_MS)
    .sort((a, b) => Number(b[1].seenAt ?? 0) - Number(a[1].seenAt ?? 0))
    .slice(0, MAX_FACEBOOK_TAB_STATES);
  return Object.fromEntries(entries);
}

function summarizeFacebookPages(tabStates) {
  const byPage = new Map();
  for (const value of Object.values(tabStates ?? {})) {
    if (!value?.pageId) continue;
    const existing = byPage.get(value.pageId);
    if (!existing || Number(value.seenAt ?? 0) > Number(existing.seenAt ?? 0)) {
      byPage.set(value.pageId, {
        pageId: value.pageId,
        pageName: value.pageName ?? null,
        loggedIn: value.loggedIn === true,
        composerState: value.composerState ?? "unknown",
        conversationId: value.conversationId ?? null,
        seenAt: Number(value.seenAt ?? 0),
      });
    }
  }
  return [...byPage.values()].sort((a, b) => b.seenAt - a.seenAt);
}

async function updateFacebookTabState(tabId, patch) {
  if (!Number.isInteger(tabId)) return;
  const current = await facebookTabStates();
  current[String(tabId)] = {
    ...(current[String(tabId)] ?? {}),
    ...patch,
    tabId,
    seenAt: Date.now(),
  };
  const entries = Object.entries(current)
    .sort((a, b) => Number(b[1].seenAt ?? 0) - Number(a[1].seenAt ?? 0))
    .slice(0, MAX_FACEBOOK_TAB_STATES);
  await writeState({ facebookTabs: Object.fromEntries(entries) });
}

async function removeFacebookTabState(tabId) {
  if (!Number.isInteger(tabId)) return;
  const current = await facebookTabStates();
  if (!current[String(tabId)]) return;
  delete current[String(tabId)];
  await writeState({ facebookTabs: current });
}

async function inspectFacebookTab(tab) {
  if (!tab?.id || !/^https:\/\/(www\.|business\.)facebook\.com\//.test(tab.url ?? "")) {
    return null;
  }
  try {
    const answer = await chrome.tabs.sendMessage(tab.id, { type: "FB_INSPECT" });
    if (!answer) return null;
    const normalized = {
      loggedIn: answer.facebookConnected === true,
      pageId: answer.pageId ?? null,
      pageName: answer.pageName ?? null,
      conversationId: answer.conversationId ?? null,
      url: tab.url ?? null,
      composerState: answer.composerEnabled
        ? "available"
        : answer.composerFound
          ? "unavailable"
          : "unknown",
      seenAt: Date.now(),
      tabId: tab.id,
    };
    await updateFacebookTabState(tab.id, normalized);
    return normalized;
  } catch {
    return null;
  }
}

async function currentFacebookContext() {
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const active = activeTabs.find((tab) =>
    /^https:\/\/(www\.|business\.)facebook\.com\//.test(tab.url ?? ""),
  );
  const inspected = await inspectFacebookTab(active);
  if (active) return inspected?.pageId ? inspected : null;

  const states = await facebookTabStates();
  const values = Object.values(states).sort(
    (a, b) => Number(b.seenAt ?? 0) - Number(a.seenAt ?? 0),
  );
  return values.find((value) => value?.pageId) ?? null;
}

async function clearAuth() {
  stopRealtime({ reason: "auth_cleared", reconnect: false });
  await Promise.all([
    chrome.storage.local.remove(["token", "device", "syncCursor"]),
    chrome.storage.session.remove([QUEUE_KEY]),
  ]);
}

/* ------------------------------------------------------------------ TENH */

async function callTenh(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${TENH_ORIGIN}${path}`, {
    method,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let result = {};

  try {
    result = await response.json();
  } catch {
    result = {};
  }

  return {
    ok: response.ok && result.success !== false,
    status: response.status,
    result,
  };
}

async function disconnect() {
  const { token } = await readState();

  if (token) {
    await callTenh("/api/extension/disconnect", { method: "POST", token }).catch(
      () => {},
    );
  }

  await clearAuth();
  return { connected: false, paired: false };
}

async function heartbeat(event) {
  const state = await readState();
  if (!state.token) return { connected: false, paired: false };

  const facebook = state.facebook ?? {};
  const tabStates = await facebookTabStates();
  const facebookPages = summarizeFacebookPages(tabStates);

  try {
    const { ok, status, result } = await callTenh("/api/extension/heartbeat", {
      method: "POST",
      token: state.token,
      body: {
        facebookConnected: facebook.loggedIn === true,
        pageId: facebook.pageId ?? null,
        pageName: facebook.pageName ?? null,
        threadId: facebook.conversationId ?? null,
        pages: facebookPages.slice(0, 50),
        pageCount: facebookPages.length,
        url: facebook.url ?? null,
        composerState: facebook.composerState ?? "unknown",
        extensionVersion: VERSION,
        pendingSyncEvents: Array.isArray(state[QUEUE_KEY]) ? state[QUEUE_KEY].length : 0,
        syncCursor: state.syncCursor ?? null,
        event: event ?? null,
      },
    });

    if (!ok && (status === 401 || status === 403)) {
      await clearAuth();
      return {
        connected: false,
        paired: false,
        error: result.error ?? "This browser was disconnected.",
      };
    }

    const pushedEvents = Array.isArray(result.events) ? result.events : [];
    for (const pushedEvent of pushedEvents) await processServerEvent(pushedEvent);

    const nextCursor = result.cursor ?? result.nextCursor ?? state.syncCursor ?? null;
    await writeState({
      ...(nextCursor !== state.syncCursor ? { syncCursor: nextCursor } : {}),
      syncStatus: {
        reachable: true,
        lastHeartbeatAt: Date.now(),
        pending: Array.isArray(state[QUEUE_KEY]) ? state[QUEUE_KEY].length : 0,
      },
    });

    return { connected: true, paired: true, result };
  } catch {
    await writeState({
      syncStatus: {
        reachable: false,
        lastHeartbeatAt: Date.now(),
        pending: Array.isArray(state[QUEUE_KEY]) ? state[QUEUE_KEY].length : 0,
      },
    });
    return { connected: true, paired: true, offline: true };
  }
}

function deviceName() {
  const platform = navigator.userAgentData?.platform ?? "";
  return platform ? `Chrome on ${platform}` : "Chrome browser";
}

/* ----------------------------------------------------------- sync engine */

async function rememberFingerprint(fingerprint, metadata = {}) {
  if (!fingerprint) return;
  const state = await readState();
  const now = Date.now();
  const recent = (Array.isArray(state.recentFingerprints) ? state.recentFingerprints : [])
    .filter((item) => now - Number(item.at ?? 0) < RECENT_FINGERPRINT_TTL_MS)
    .filter((item) => item.fingerprint !== fingerprint);

  recent.push({
    fingerprint,
    at: now,
    status: metadata.status ?? "observed",
    providerMessageId: metadata.providerMessageId ?? null,
  });

  if (recent.length > MAX_RECENT_FINGERPRINTS) {
    recent.splice(0, recent.length - MAX_RECENT_FINGERPRINTS);
  }
  await writeState({ recentFingerprints: recent });
}

async function hasRecentFingerprint(fingerprint) {
  if (!fingerprint) return false;
  const state = await readState();
  const now = Date.now();
  return (Array.isArray(state.recentFingerprints) ? state.recentFingerprints : []).some(
    (item) => item.fingerprint === fingerprint && now - Number(item.at ?? 0) < RECENT_FINGERPRINT_TTL_MS,
  );
}

async function removeQueuedFingerprint(fingerprint) {
  if (!fingerprint) return false;
  const state = await readState();
  const queue = Array.isArray(state[QUEUE_KEY]) ? state[QUEUE_KEY] : [];
  const next = queue.filter((item) => item.dedupeKey !== fingerprint && item.payload?.fingerprint !== fingerprint);
  if (next.length === queue.length) return false;
  await chrome.storage.session.set({ [QUEUE_KEY]: next });
  return true;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function outgoingFingerprint(payload) {
  const bucket = Math.floor(Number(payload.observedAt ?? Date.now()) / 5000);
  return sha256(
    [
      payload.pageId ?? "",
      payload.threadId ?? payload.conversationId ?? "",
      normalizeText(payload.text),
      bucket,
    ].join("|"),
  );
}

async function enqueueSyncEvent(type, payload, { dedupeKey } = {}) {
  if (dedupeKey && (await hasRecentFingerprint(dedupeKey))) {
    return { id: null, type, payload, dedupeKey, duplicate: true, createdAt: Date.now() };
  }

  const state = await readState();
  const now = Date.now();
  const queue = (Array.isArray(state[QUEUE_KEY]) ? state[QUEUE_KEY] : []).filter(
    (item) => now - Number(item.createdAt ?? 0) < MAX_EVENT_AGE_MS,
  );

  if (dedupeKey) {
    const existing = queue.find(
      (item) => item.type === type && item.dedupeKey === dedupeKey,
    );
    if (existing) return existing;
  }

  const item = {
    id: crypto.randomUUID(),
    type,
    payload,
    dedupeKey: dedupeKey ?? null,
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
  };

  queue.push(item);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  await chrome.storage.session.set({ [QUEUE_KEY]: queue });
  void flushSyncQueue();
  return item;
}

function retryDelay(attempts) {
  return Math.min(MAX_RETRY_MS, 1000 * 2 ** Math.min(attempts, 8));
}

async function deliverSyncEvent(item, token) {
  if (item.type === "facebook.outgoing") {
    const { status, ok, result } = await callTenh("/api/extension/observed-message", {
      method: "POST",
      token,
      body: {
        eventId: item.id,
        fingerprint: item.payload.fingerprint ?? null,
        pageId: item.payload.pageId ?? null,
        threadId: item.payload.threadId ?? null,
        text: item.payload.text ?? "",
        observedAt: item.payload.observedAt ?? item.createdAt,
        source: "facebook_browser",
      },
    });

    if (ok && item.payload.fingerprint) {
      await rememberFingerprint(item.payload.fingerprint, {
        status: result.confirmed === true ? "confirmed" : "delivered",
        providerMessageId: result.providerMessageId ?? result.messageId ?? null,
      });
    }

    return {
      delivered: ok,
      authRejected: status === 401 || status === 403,
      permanent: status >= 400 && status < 500 && status !== 408 && status !== 429,
      result,
    };
  }

  if (item.type === "facebook.activity") {
    const { status, ok, result } = await callTenh("/api/extension/reconcile", {
      method: "POST",
      token,
      body: {
        eventId: item.id,
        pageId: item.payload.pageId ?? null,
        threadId: item.payload.threadId ?? null,
        observedAt: item.payload.observedAt ?? item.createdAt,
        reason: item.payload.reason ?? "browser_activity",
        source: "facebook_browser",
      },
    });

    /* Older TENH backends do not have /reconcile yet. Do not retry a missing
       optional endpoint forever; the normal Meta webhook remains primary. */
    if (status === 404 || status === 405) {
      await heartbeat("browser_activity");
      return { delivered: true, unsupported: true, result };
    }

    return {
      delivered: ok,
      authRejected: status === 401 || status === 403,
      permanent: status >= 400 && status < 500 && status !== 408 && status !== 429,
      result,
    };
  }

  return { delivered: true, ignored: true };
}

async function flushSyncQueue() {
  if (flushPromise) return flushPromise;

  flushPromise = (async () => {
    const state = await readState();
    if (!state.token) return { flushed: 0, pending: 0 };

    let queue = Array.isArray(state[QUEUE_KEY]) ? [...state[QUEUE_KEY]] : [];
    const now = Date.now();
    let flushed = 0;

    for (const item of [...queue]) {
      if (Number(item.nextAttemptAt ?? 0) > now) continue;

      let result;
      try {
        result = await deliverSyncEvent(item, state.token);
      } catch {
        result = { delivered: false, permanent: false };
      }

      if (result.authRejected) {
        await clearAuth();
        break;
      }

      if (result.delivered || result.permanent) {
        queue = queue.filter((queued) => queued.id !== item.id);
        flushed += 1;
        continue;
      }

      queue = queue.map((queued) => {
        if (queued.id !== item.id) return queued;
        const attempts = Number(queued.attempts ?? 0) + 1;
        return {
          ...queued,
          attempts,
          nextAttemptAt: Date.now() + retryDelay(attempts),
        };
      });
    }

    await chrome.storage.session.set({ [QUEUE_KEY]: queue });
    await writeState({
      syncStatus: {
        reachable: true,
        lastFlushAt: Date.now(),
        pending: queue.length,
      },
    });

    return { flushed, pending: queue.length };
  })().finally(() => {
    flushPromise = null;
  });

  return flushPromise;
}

async function acknowledgeServerEvent(event) {
  const eventId = event?.eventId ?? event?.id ?? null;
  if (!eventId) return;

  if (realtimeSocket?.readyState === WebSocket.OPEN) {
    try {
      realtimeSocket.send(JSON.stringify({
        type: "ack",
        eventId,
        cursor: event.cursor ?? null,
        at: Date.now(),
      }));
      return;
    } catch {
      /* Fall back to optional HTTP ACK below. */
    }
  }

  const state = await readState();
  if (!state.token) return;
  try {
    const response = await callTenh(REALTIME_ACK_PATH, {
      method: "POST",
      token: state.token,
      body: { eventId, cursor: event.cursor ?? null, at: Date.now() },
    });
    if (response.status === 404 || response.status === 405) return;
  } catch {
    /* ACK is an optimization; delta sync remains the recovery path. */
  }
}

async function reconcileServerEvent(event) {
  if (!event || typeof event !== "object") return;

  const fingerprint =
    typeof event.fingerprint === "string"
      ? event.fingerprint
      : typeof event.data?.fingerprint === "string"
        ? event.data.fingerprint
        : null;

  const confirmed =
    event.type === "message.confirmed" ||
    event.type === "message.sent" ||
    event.confirmed === true ||
    event.data?.confirmed === true;

  if (fingerprint && confirmed) {
    await removeQueuedFingerprint(fingerprint);
    await rememberFingerprint(fingerprint, {
      status: "confirmed",
      providerMessageId:
        event.providerMessageId ?? event.messageId ?? event.data?.providerMessageId ?? null,
    });
  }

  const cursor = event.cursor ?? event.nextCursor ?? null;
  if (cursor !== null && cursor !== undefined) {
    await writeState({ syncCursor: cursor });
  }
}

async function broadcastSyncEvent(event, { toTenhTabs = true } = {}) {
  await reconcileServerEvent(event);

  /* Long-lived TENH content-script ports get the event first. */
  for (const port of [...tenhRealtimePorts]) {
    try {
      port.postMessage({ type: "TENH_SYNC_PUSH", event });
    } catch {
      tenhRealtimePorts.delete(port);
    }
  }

  /* Extension views (side panel/popup). */
  chrome.runtime.sendMessage({ type: "TENH_SYNC_PUSH", event }, () => {
    void chrome.runtime.lastError;
  });

  if (!toTenhTabs) return;

  /* Fallback for TENH tabs that do not have a live Port yet. */
  const tabs = await chrome.tabs.query({ url: [`${TENH_ORIGIN}/*`] });
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, { type: "TENH_SYNC_PUSH", event }, () => {
      void chrome.runtime.lastError;
    });
  }
}

async function processServerEvent(event) {
  if (!event || typeof event !== "object") return;
  await broadcastSyncEvent(event);
  await acknowledgeServerEvent(event);
}

/* ----------------------------------------------------------- realtime */

function realtimeBackoff(attempts) {
  return Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6));
}

function clearRealtimeTimers() {
  if (realtimePingTimer) clearInterval(realtimePingTimer);
  if (realtimeReconnectTimer) clearTimeout(realtimeReconnectTimer);
  realtimePingTimer = null;
  realtimeReconnectTimer = null;
}

async function setRealtimeStatus(patch) {
  const state = await readState();
  await writeState({
    realtimeStatus: {
      ...(state.realtimeStatus ?? {}),
      ...patch,
      updatedAt: Date.now(),
    },
  });
}

function isAllowedRealtimeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "wss:" && url.hostname === "app.tenhchat.com";
  } catch {
    return false;
  }
}

function scheduleRealtimeReconnect() {
  if (realtimeReconnectTimer) return;
  const delay = realtimeBackoff(realtimeAttempts);
  realtimeReconnectTimer = setTimeout(() => {
    realtimeReconnectTimer = null;
    void ensureRealtimeConnection({ force: true });
  }, delay);
}

function stopRealtime({ reason = "stopped", reconnect = false } = {}) {
  clearRealtimeTimers();
  const socket = realtimeSocket;
  realtimeSocket = null;

  if (socket && socket.readyState < WebSocket.CLOSING) {
    try {
      socket.close(1000, reason.slice(0, 120));
    } catch {
      /* noop */
    }
  }

  void setRealtimeStatus({ connected: false, connecting: false, reason });
  if (reconnect) scheduleRealtimeReconnect();
}

async function requestRealtimeSession(state) {
  const response = await callTenh(REALTIME_SESSION_PATH, {
    method: "POST",
    token: state.token,
    body: {
      extensionVersion: VERSION,
      installationId: state.installationId,
      deviceId: state.device?.id ?? null,
      cursor: state.syncCursor ?? null,
    },
  });

  if (response.status === 404 || response.status === 405) {
    await writeState({ realtimeUnsupportedUntil: Date.now() + REALTIME_UNSUPPORTED_MS });
    await setRealtimeStatus({
      connected: false,
      connecting: false,
      supported: false,
      mode: tenhRealtimePorts.size ? "tenh_tab_bridge" : "delta",
    });
    return { supported: false };
  }

  if (response.status === 401 || response.status === 403) {
    await clearAuth();
    return { supported: true, authRejected: true };
  }

  const url = response.result.websocketUrl ?? response.result.url ?? null;
  if (!response.ok || !isAllowedRealtimeUrl(url)) {
    return { supported: true, ok: false };
  }

  return { supported: true, ok: true, url };
}

async function ensureRealtimeConnection({ force = false } = {}) {
  if (realtimeSocket?.readyState === WebSocket.OPEN) return { connected: true, mode: "websocket" };
  if (realtimeConnectPromise) return realtimeConnectPromise;

  realtimeConnectPromise = (async () => {
    const state = await readState();
    if (!state.token) return { connected: false };

    if (!force && Number(state.realtimeUnsupportedUntil ?? 0) > Date.now()) {
      await setRealtimeStatus({
        connected: tenhRealtimePorts.size > 0,
        connecting: false,
        supported: false,
        mode: tenhRealtimePorts.size ? "tenh_tab_bridge" : "delta",
      });
      return { connected: tenhRealtimePorts.size > 0, mode: tenhRealtimePorts.size ? "tenh_tab_bridge" : "delta" };
    }

    await setRealtimeStatus({ connecting: true, supported: true });

    let session;
    try {
      session = await requestRealtimeSession(state);
    } catch {
      realtimeAttempts += 1;
      await setRealtimeStatus({
        connected: tenhRealtimePorts.size > 0,
        connecting: false,
        mode: tenhRealtimePorts.size ? "tenh_tab_bridge" : "delta",
        error: "session_unreachable",
      });
      scheduleRealtimeReconnect();
      return { connected: false };
    }

    if (!session.supported || session.authRejected || !session.ok) {
      if (session.supported && !session.authRejected) scheduleRealtimeReconnect();
      return { connected: tenhRealtimePorts.size > 0, mode: tenhRealtimePorts.size ? "tenh_tab_bridge" : "delta" };
    }

    return await new Promise((resolve) => {
      let settled = false;
      const socket = new WebSocket(session.url);
      realtimeSocket = socket;

      const settle = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      socket.addEventListener("open", async () => {
        realtimeAttempts = 0;
        await writeState({ realtimeUnsupportedUntil: 0 });
        await setRealtimeStatus({
          connected: true,
          connecting: false,
          supported: true,
          mode: "websocket",
          connectedAt: Date.now(),
          error: null,
        });

        try {
          socket.send(JSON.stringify({
            type: "hello",
            extensionVersion: VERSION,
            installationId: state.installationId,
            deviceId: state.device?.id ?? null,
            cursor: state.syncCursor ?? null,
          }));
        } catch {
          /* noop */
        }

        clearRealtimeTimers();
        realtimePingTimer = setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          try {
            socket.send(JSON.stringify({ type: "ping", at: Date.now() }));
          } catch {
            /* close handler will recover */
          }
        }, REALTIME_PING_MS);

        void deltaSync();
        settle({ connected: true, mode: "websocket" });
      });

      socket.addEventListener("message", (message) => {
        void (async () => {
          let payload;
          try {
            payload = JSON.parse(String(message.data ?? "{}"));
          } catch {
            return;
          }

          if (payload.type === "ping") {
            try {
              socket.send(JSON.stringify({ type: "pong", at: Date.now() }));
            } catch {
              /* noop */
            }
            return;
          }

          if (payload.type === "event" && payload.event) {
            await processServerEvent(payload.event);
          } else if (payload.event && typeof payload.event === "object") {
            await processServerEvent(payload.event);
          }
        })();
      });

      socket.addEventListener("close", () => {
        if (realtimeSocket === socket) realtimeSocket = null;
        clearRealtimeTimers();
        realtimeAttempts += 1;
        void setRealtimeStatus({
          connected: tenhRealtimePorts.size > 0,
          connecting: false,
          mode: tenhRealtimePorts.size ? "tenh_tab_bridge" : "delta",
          disconnectedAt: Date.now(),
        });
        void deltaSync();
        scheduleRealtimeReconnect();
        settle({ connected: false });
      });

      socket.addEventListener("error", () => {
        try {
          socket.close();
        } catch {
          /* noop */
        }
      });

      setTimeout(() => {
        if (socket.readyState === WebSocket.CONNECTING) {
          try {
            socket.close();
          } catch {
            /* noop */
          }
          settle({ connected: false, timeout: true });
        }
      }, 10_000);
    });
  })().finally(() => {
    realtimeConnectPromise = null;
  });

  return realtimeConnectPromise;
}


async function deltaSync() {
  if (deltaPromise) return deltaPromise;

  deltaPromise = (async () => {
    const state = await readState();
    if (!state.token) return { supported: false };

    const params = new URLSearchParams();
    if (state.syncCursor) params.set("cursor", String(state.syncCursor));
    params.set("limit", "100");

    let response;
    try {
      response = await callTenh(`/api/extension/sync/delta?${params.toString()}`, {
        token: state.token,
      });
    } catch {
      return { supported: true, offline: true };
    }

    if (response.status === 401 || response.status === 403) {
      await clearAuth();
      return { supported: true, connected: false };
    }

    if (response.status === 404 || response.status === 405) {
      return { supported: false };
    }

    if (!response.ok) return { supported: true, ok: false };

    const events = Array.isArray(response.result.events) ? response.result.events : [];
    for (const event of events) await processServerEvent(event);

    const cursor = response.result.cursor ?? response.result.nextCursor ?? state.syncCursor ?? null;
    if (cursor !== state.syncCursor) await writeState({ syncCursor: cursor });

    return { supported: true, ok: true, count: events.length, cursor };
  })().finally(() => {
    deltaPromise = null;
  });

  return deltaPromise;
}

/* -------------------------------------------------------------- Facebook */

function facebookTarget({ pageId, threadId } = {}) {
  const url = new URL("https://business.facebook.com/latest/inbox/all/");
  if (typeof pageId === "string" && /^\d+$/.test(pageId)) {
    url.searchParams.set("asset_id", pageId); url.searchParams.set("mailbox_id", pageId);
  }
  if (typeof threadId === "string" && /^\d+$/.test(threadId)) {
    url.searchParams.set("selected_item_id", threadId); url.searchParams.set("thread_type", "FB_MESSAGE");
  }
  return url.toString();
}

async function tabById(tabId) {
  if (!Number.isInteger(tabId)) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function waitForFacebookBridge(
  tabId,
  timeoutMs = 15000,
  { pageId, conversationId } = {},
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const answer = await chrome.tabs.sendMessage(tabId, { type: "FB_INSPECT" });
      const pageMatches = !pageId || answer?.pageId === pageId;
      const conversationMatches =
        !conversationId || answer?.conversationId === conversationId;

      if (answer && pageMatches && conversationMatches) {
        return { ...answer, tabId };
      }
    } catch {
      /* Content script not ready yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

async function ensureManagedFacebookTab({ pageId, threadId, conversationId, active = false } = {}) {
  const state = await readState();
  const facebookThreadId = threadId ?? conversationId ?? null;
  const target = facebookTarget({ pageId, threadId: facebookThreadId });
  const managed = await tabById(state.managedFacebookTabId);

  if (managed?.id && /^https:\/\/business\.facebook\.com\/latest\/inbox\//.test(managed.url ?? "")) {
    const shouldNavigate = pageId || facebookThreadId;
    if (shouldNavigate && managed.url !== target) {
      await chrome.tabs.update(managed.id, { url: target, active });
    } else if (active) {
      await chrome.tabs.update(managed.id, { active: true });
    }

    if (active && managed.windowId) {
      await chrome.windows.update(managed.windowId, { focused: true });
    }
    return await chrome.tabs.get(managed.id);
  }

  /* Reuse an existing exact Facebook inbox tab when it already matches the
     requested Page/thread. Never navigate an arbitrary user-created tab. */
  const candidates = await chrome.tabs.query({
    url: ["https://www.facebook.com/*", "https://business.facebook.com/*"],
  });
  const exact = candidates.find((tab) => {
    try {
      const url = new URL(tab.url ?? "");
      return url.origin === "https://business.facebook.com" &&
        url.pathname.startsWith("/latest/inbox/") &&
        (!pageId || url.searchParams.get("asset_id") === String(pageId)) &&
        (!facebookThreadId || url.searchParams.get("selected_item_id") === String(facebookThreadId));
    } catch {
      return false;
    }
  });

  if (exact?.id) {
    if (active) {
      await chrome.tabs.update(exact.id, { active: true });
      if (exact.windowId) await chrome.windows.update(exact.windowId, { focused: true });
    }
    return exact;
  }

  const created = await chrome.tabs.create({ url: target, active });
  await writeState({
    managedFacebookTabId: created.id ?? null,
    managedFacebookWindowId: created.windowId ?? null,
  });
  return created;
}

function scoreFacebookAnswer(answer, expected = {}) {
  const pageExact = !expected.pageId || answer.pageId === expected.pageId;
  const threadExact =
    !expected.conversationId || answer.conversationId === expected.conversationId;

  return (
    (pageExact ? 32 : -64) +
    (threadExact ? 64 : -128) +
    (answer.composerEnabled ? 8 : 0) +
    (answer.composerFound ? 4 : 0) +
    (answer.conversationVisible ? 2 : 0) +
    (answer.facebookConnected ? 1 : 0)
  );
}

async function askFacebook(
  message,
  { ensure = false, pageId, threadId, conversationId } = {},
) {
  const facebookThreadId = threadId ?? conversationId ?? null;

  if (ensure) {
    const managed = await ensureManagedFacebookTab({
      pageId,
      threadId: facebookThreadId,
      active: false,
    });
    if (managed?.id) {
      await waitForFacebookBridge(managed.id, 15000, {
        pageId,
        conversationId: facebookThreadId,
      });
    }
  }

  const tabs = await chrome.tabs.query({
    url: ["https://www.facebook.com/*", "https://business.facebook.com/*"],
  });
  const answers = [];

  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, message);
      if (reply) answers.push({ ...reply, tabId: tab.id, tabUrl: tab.url ?? null });
    } catch {
      /* loading/no bridge */
    }
  }

  if (answers.length === 0) {
    return {
      facebookConnected: false,
      conversationVisible: false,
      composerFound: false,
      composerEnabled: false,
      reason: "facebook_bridge_unavailable",
    };
  }

  const expected = { pageId, conversationId: facebookThreadId };
  answers.sort(
    (left, right) => scoreFacebookAnswer(right, expected) - scoreFacebookAnswer(left, expected),
  );
  const best = answers[0];

  if (pageId && best.pageId !== pageId) {
    return { ...best, composerEnabled: false, reason: "page_mismatch" };
  }
  if (facebookThreadId && best.conversationId !== facebookThreadId) {
    return { ...best, composerEnabled: false, reason: "conversation_mismatch" };
  }

  return best;
}

let navigationQueue = Promise.resolve();
const pendingNavigations = new Map();
async function openFacebook(options = {}, sender) {
  const { pageId, threadId, conversationId, businessId } = options;
  const internal = sender?.id === chrome.runtime.id && typeof sender?.url === "string" && sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
  // Popup's generic Open Facebook button remains a deliberate navigation action.
  if (internal && !pageId && !threadId && !conversationId) {
    const tab = await ensureManagedFacebookTab({ active: true }); return { opened: Boolean(tab?.id), exactRequested: false };
  }
  if (sender?.id !== chrome.runtime.id || !sender?.tab?.id || sender.frameId !== 0) return { opened: false, reason: "untrusted_sender" };
  try { if (new URL(sender.url || sender.tab.url).origin !== TENH_ORIGIN) return { opened: false, reason: "untrusted_sender" }; }
  catch { return { opened: false, reason: "untrusted_sender" }; }
  if (![pageId, threadId].every(value => typeof value === "string" && /^\d+$/.test(value)) || typeof conversationId !== "string") return { opened: false, reason: "conversation_context_incomplete" };
  const key = JSON.stringify([sender.tab.id, businessId, conversationId, pageId, threadId]);
  if (pendingNavigations.has(key)) return pendingNavigations.get(key);
  const task = async () => {
    const state = await readState(); if (!state.token) return { opened: false, reason: "tenh_sign_in_required" };
    let response;
    try { response = await callTenh("/api/extension/conversations/open-context", { token: state.token, method: "POST", body: { pageId, threadId, conversationId, businessId } }); }
    catch { return { opened: false, reason: "conversation_authorization_unavailable" }; }
    const result = response.result;
    if (!response.ok || result?.verified !== true || result.pageId !== pageId || result.threadId !== threadId || result.conversationId !== conversationId ||
        (businessId && result.businessId !== businessId)) return { opened: false, reason: response.status === 404 ? "website_update_required" : "conversation_context_mismatch" };
    const tab = await ensureManagedFacebookTab({ pageId, threadId, active: true });
    return { opened: Boolean(tab?.id), tabId: tab?.id, pageId, threadId, conversationId, businessId: result.businessId, exactRequested: true };
  };
  const operation = navigationQueue.then(task, task).catch(() => ({ opened: false, reason: "facebook_navigation_failed" }));
  navigationQueue = operation.then(() => undefined, () => undefined);
  pendingNavigations.set(key, operation);
  try { return await operation; } finally { pendingNavigations.delete(key); }
}

/* Profile lookup is an explicit click action, independent of sync/startup.
 * Two phases let TENH cancel opening if the agent switches customers mid-lookup.
 */
const PROFILE_TICKETS_KEY = "facebookProfileTickets";
let profileLookupBusy = false;
let profileOpenQueue = Promise.resolve();
const profilePause = () => new Promise(resolve => setTimeout(resolve, 500));
async function profileDeadline(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("profile_request_timeout")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function profileSenderAllowed(sender) {
  try {
    return sender?.id === chrome.runtime.id && sender.frameId === 0 && Boolean(sender.tab?.id) &&
      new URL(sender.url || sender.tab.url).origin === TENH_ORIGIN;
  } catch { return false; }
}
function profileContextEqual(left, right) {
  return ["businessId", "conversationId", "pageId", "threadId"].every(key => left?.[key] === right?.[key]);
}
function safePublicProfile(value, context) {
  try {
    if (typeof value !== "string" || value.length > 2048) return null;
    const url = new URL(value);
    if (url.protocol !== "https:" || !["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
    const path = url.pathname.replace(/\/+$/, "");
    const id = path === "/profile.php" ? (url.searchParams.getAll("id").length === 1 ? url.searchParams.get("id") : "invalid")
      : path.match(/^\/(?:people\/[^/]+\/)?(\d+)$/)?.[1];
    if (id) return /^\d{1,30}$/.test(id) && id !== context.threadId && id !== context.pageId ? `https://www.facebook.com/profile.php?id=${id}` : null;
    if (!/^\/[A-Za-z0-9._-]{2,100}$/.test(path) || /\.php$/i.test(path) ||
        /^\/(?:me|business|latest|messages|login|logout|checkpoint|settings|help|groups|pages|watch|reels|marketplace|search|friends|bookmarks|gaming|ads|privacy|notifications|home|photo|photos|posts|videos|share|story)$/i.test(path)) return null;
    return `https://www.facebook.com${path}`;
  } catch { return null; }
}
// Parse the actual inbox route separately from the Messenger PSID.
function profileInboxRoute(value, pageId) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["business.facebook.com", "www.facebook.com", "facebook.com"].includes(url.hostname)) return null;
    const pages = ["asset_id", "page_id", "mailbox_id"].flatMap(key => url.searchParams.getAll(key));
    if (pages.some(id => id !== pageId)) return null;
    const selected = ["selected_item_id", "thread_id"].flatMap(key => url.searchParams.getAll(key));
    if (selected.length && (new Set(selected).size !== 1 || !/^\d{1,32}$/.test(selected[0]))) return null;
    if (url.searchParams.getAll("thread_type").some(type => type !== "FB_MESSAGE")) return null;
    const sections = url.searchParams.getAll("section");
    if (sections.length > 1 || sections.some(section => section !== "messages")) return null;
    if (url.hostname === "business.facebook.com") {
      if (!/^\/latest\/inbox(?:\/[^/]+)?\/?$/.test(url.pathname) || !pages.length || !selected.length) return null;
      return { key: `suite:${pageId}:${selected[0]}`, selectedItemId: selected[0], url: url.href, suite: true };
    }
    const segments = url.pathname.split("/").filter(Boolean);
    const pageInbox = segments[0] === pageId && ["messages", "inbox"].includes(segments[1]) && segments.length === 2;
    const pageInboxThread = segments[0] === pageId && segments[1] === "inbox" &&
      segments.length === 3 && /^\d{1,32}$/.test(segments[2]);
    const messages = segments[0] === "messages" && (segments.length === 1 || (segments[1] === "t" && segments.length === 3));
    const legacyIds = ["threadid", "tid"].flatMap(key => url.searchParams.getAll(key));
    if (legacyIds.some(id => !/^[A-Za-z0-9_.:-]{1,200}$/.test(id))) return null;
    if (pageInboxThread && (selected.length || legacyIds.length)) return null;
    if (!(pageInboxThread || pageInbox || messages) || (!selected.length && !legacyIds.length && segments.length !== 3)) return null;
    const params = [...url.searchParams.entries()].filter(([key]) => ["selected_item_id", "thread_id", "threadid", "tid"].includes(key)).sort();
    return { key: `${segments.join("/")}:${JSON.stringify(params)}`, selectedItemId: selected[0] || null, url: url.href, suite: false };
  } catch { return null; }
}
function isExactProfileInbox(tab, context) {
  const expected = profileInboxRoute(context.loadedConversationLink || context.conversationLink, context.pageId);
  const actual = profileInboxRoute(tab?.url, context.pageId);
  return Boolean(expected && actual && expected.key === actual.key);
}
async function authorizeProfile(context, sender) {
  if (!profileSenderAllowed(sender)) return { reason: "untrusted_sender" };
  if (![context.pageId, context.threadId].every(id => typeof id === "string" && /^\d{1,32}$/.test(id)) ||
      ![context.businessId, context.conversationId].every(id => typeof id === "string" && id.length > 0 && id.length <= 100)) return { reason: "profile_context_incomplete" };
  const state = await readState();
  if (!state.token) return { reason: "tenh_sign_in_required" };
  try {
    const response = await profileDeadline(callTenh("/api/extension/conversations/open-context", {
      token: state.token, method: "POST", body: {
        businessId: context.businessId, conversationId: context.conversationId,
        pageId: context.pageId, threadId: context.threadId, profileLookup: true,
      },
    }), 8000);
    if (!response.ok || response.result?.verified !== true || !profileContextEqual(response.result, context)) {
      const reason = response.result?.reason;
      return { reason: ["profile_conversation_link_unavailable", "profile_conversation_ambiguous", "profile_conversation_access_unavailable", "profile_conversation_lookup_failed",
        "profile_conversation_not_found", "profile_conversation_participants_unmatched", "profile_conversation_link_unsupported", "profile_conversation_link_missing",
        "profile_conversation_name_unavailable", "profile_conversation_request_failed"].includes(reason) ? reason : "profile_context_unmatched" };
    }
    if (response.result.sourceType !== "messenger") return { reason: "profile_messenger_required" };
    if (!response.result.customerName?.trim()) return { reason: "profile_context_incomplete" };
    if (response.result.linkSource !== "meta_conversations_api" ||
        !profileInboxRoute(response.result.conversationLink, context.pageId)) return { reason: "profile_conversation_link_unavailable" };
    return { context: { businessId: context.businessId, conversationId: context.conversationId,
      pageId: context.pageId, threadId: context.threadId, customerName: response.result.customerName,
      conversationLink: response.result.conversationLink, linkSource: response.result.linkSource } };
  } catch { return { reason: "tenh_authorization_unavailable" }; }
}
async function profileScript(tabId, options, action) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, args: [options, action],
    func: (context, action) => {
      if (action === "validate") return globalThis.TenhFacebookSelectors?.validateCurrentProfilePage(context.customerName, context.threadId);
      if (action === "reveal") return globalThis.TenhFacebookProfileResolver?.reveal(context);
      return globalThis.TenhFacebookProfileResolver?.readCurrent(context);
    },
  });
  return results.find(result => result.frameId === 0)?.result ?? {};
}
async function loadProfileScripts(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["src/facebook-selectors.js", "src/facebook-profile-resolver.js"] });
}
async function readStableCustomerLink(tabId, context, owned) {
  const deadline = Date.now() + 22000;
  let previous = null, injected = false, reason = "profile_link_missing";
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    // A new Chrome tab can report a blank url + pendingUrl while loading.
    // Wait for the loaded document before checking its actual destination.
    if (tab.status !== "complete") { await profilePause(); continue; }
    if (/\/login|\/checkpoint/.test(tab.url ?? "")) return { reason: "facebook_sign_in_required" };
    if (!isExactProfileInbox(tab, context)) {
      // A Meta-returned legacy thread link can redirect into Business Suite.
      // Only follow that transition in our own newly created inactive tab.
      const expected = profileInboxRoute(context.conversationLink, context.pageId);
      const actual = profileInboxRoute(tab.url, context.pageId);
      if (!owned || tab.active || context.loadedConversationLink || !expected || expected.suite || !actual?.suite ||
          (expected.selectedItemId && expected.selectedItemId !== actual.selectedItemId)) return { reason: "profile_lookup_interrupted" };
      context.loadedConversationLink = tab.url;
    }
    if (tab.status === "complete") {
      try {
        if (!injected) { await loadProfileScripts(tabId); injected = true; }
        const result = await profileScript(tabId, context, "read");
        const url = safePublicProfile(result.profileUrl, context);
        if (result.found && result.pageId === context.pageId && result.matchedThreadId === context.threadId && url) {
          if (previous === url) return { profileUrl: url };
          previous = url;
        } else {
          previous = null; reason = result.reason || "profile_link_missing";
          if (["ambiguous_profile", "facebook_sign_in_required", "conversation_mismatch", "facebook_no_contact_card", "facebook_inbox_load_failed"].includes(reason)) return { reason };
        }
      } catch { injected = false; reason = "facebook_bridge_unavailable"; }
    }
    await profilePause();
  }
  return { reason };
}
async function closeOwnedProfileTab(tabId, matches) {
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    // A tab the user takes over is theirs now. Never close or navigate it.
    if (!tab.active && matches(tab)) await chrome.tabs.remove(tabId);
  } catch { /* Already closed. */ }
}
async function openFacebookCustomerProfile(options, sender) {
  if (!profileSenderAllowed(sender)) return { opened: false, reason: "untrusted_sender" };
  if (profileLookupBusy) return { opened: false, reason: "profile_lookup_busy" };
  profileLookupBusy = true;
  let lookupTabId = null, previewTabId = null, context, profileUrl, previewLastUrl;
  try {
    const authorization = await authorizeProfile(options, sender);
    if (!authorization.context) return { opened: false, reason: authorization.reason };
    context = authorization.context;
    const tabs = await chrome.tabs.query({ url: ["https://business.facebook.com/*", "https://www.facebook.com/*"] });
    const existing = tabs.find(tab => isExactProfileInbox(tab, context));
    let tab = existing;
    if (!tab) {
      tab = await chrome.tabs.create({ url: context.conversationLink, active: false });
      lookupTabId = tab.id;
    }
    const found = await readStableCustomerLink(tab.id, context, !existing);
    if (!found.profileUrl) return { opened: false, reason: found.reason };
    profileUrl = found.profileUrl;
    // Verify that Facebook loads the public profile, not an unavailable page.
    const preview = await chrome.tabs.create({ url: profileUrl, active: false });
    previewTabId = preview.id; previewLastUrl = profileUrl;
    const deadline = Date.now() + 18000;
    let previous = null, verifiedUrl = null, reason = "profile_identity_unverified";
    while (Date.now() < deadline) {
      const current = await chrome.tabs.get(previewTabId);
      if (current.active) return { opened: false, reason: "profile_lookup_interrupted" };
      if (current.status !== "complete") { await profilePause(); continue; }
      if (/\/login|\/checkpoint/.test(current.url ?? "")) return { opened: false, reason: "facebook_sign_in_required" };
      if (!safePublicProfile(current.url, context)) return { opened: false, reason: "not_profile_route" };
      previewLastUrl = current.url;
      if (current.status === "complete") {
        await loadProfileScripts(previewTabId);
        const result = await profileScript(previewTabId, context, "validate");
        const url = safePublicProfile(result.url, context);
        if (result.valid && result.nameMatches && url) {
          if (previous === url) { verifiedUrl = url; break; }
          previous = url;
        } else {
          previous = null; reason = result.reason || reason;
          if (["facebook_content_unavailable", "facebook_sign_in_required"].includes(reason)) return { opened: false, reason };
        }
      }
      await profilePause();
    }
    if (!verifiedUrl) return { opened: false, reason };
    const openToken = crypto.randomUUID();
    // Serialize ticket creation with consumption so overlapping requests cannot
    // restore a consumed ticket from an older storage snapshot.
    const storeTicket = async () => {
      const data = await chrome.storage.session.get(PROFILE_TICKETS_KEY);
      const tickets = Object.fromEntries(Object.entries(data[PROFILE_TICKETS_KEY] || {}).filter(([, ticket]) => ticket.expiresAt > Date.now()));
      tickets[openToken] = { context, url: verifiedUrl, expiresAt: Date.now() + 60000,
        tabId: sender.tab.id, documentId: sender.documentId ?? null };
      await chrome.storage.session.set({ [PROFILE_TICKETS_KEY]: tickets });
    };
    const stored = profileOpenQueue.then(storeTicket, storeTicket);
    profileOpenQueue = stored.then(() => undefined, () => undefined);
    await stored;
    return { ...context, opened: false, resolved: true, verified: true,
      profileUrl: verifiedUrl, profileId: new URL(verifiedUrl).searchParams.get("id"), openToken };
  } catch { return { opened: false, reason: "profile_resolution_unavailable" }; }
  finally {
    await closeOwnedProfileTab(lookupTabId, tab => isExactProfileInbox({ url: tab.pendingUrl || tab.url }, context) || /https:\/\/www\.facebook\.com\/(login|checkpoint)/.test(tab.url ?? ""));
    await closeOwnedProfileTab(previewTabId, tab => (tab.pendingUrl || tab.url) === previewLastUrl || /https:\/\/www\.facebook\.com\/(login|checkpoint)/.test(tab.url ?? ""));
    profileLookupBusy = false;
  }
}
async function openResolvedFacebookProfile(openToken, sender, options) {
  const task = async () => {
    if (!profileSenderAllowed(sender)) return { opened: false, reason: "untrusted_sender" };
    if (typeof openToken !== "string") return { opened: false, reason: "profile_resolution_expired" };
    const data = await chrome.storage.session.get(PROFILE_TICKETS_KEY);
    const tickets = data[PROFILE_TICKETS_KEY] || {}, ticket = tickets[openToken];
    if (!ticket || ticket.expiresAt <= Date.now() || ticket.tabId !== sender.tab.id ||
        ticket.documentId !== (sender.documentId ?? null) || !profileContextEqual(ticket.context, options)) return { opened: false, reason: "profile_resolution_expired" };
    delete tickets[openToken];
    await chrome.storage.session.set({ [PROFILE_TICKETS_KEY]: tickets });
    const authorization = await authorizeProfile(ticket.context, sender);
    if (!authorization.context) return { opened: false, reason: authorization.reason };
    const url = safePublicProfile(ticket.url, ticket.context);
    if (!url) return { opened: false, reason: "profile_url_unsupported" };
    const tab = await chrome.tabs.create({ url, active: true });
    return { ...ticket.context, opened: Boolean(tab?.id), verified: true, profileUrl: url };
  };
  const pending = profileOpenQueue.then(task, task).catch(() => ({ opened: false, reason: "profile_tab_unavailable" }));
  profileOpenQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

async function warmFacebookCompanion() {
  const state = await readState();
  if (!state.token || state.keepFacebookActive !== true) return;

  try {
    // Startup/pairing may inspect existing tabs, but must never open one.
    await askFacebook({ type: "FB_INSPECT" }, { ensure: false });
  } catch {
    /* Optional browser helper only. */
  }
}

/* ------------------------------------------------------------- messaging */

async function handle(message, sender) {
  switch (message?.type) {
    case "TENH_EXTENSION_PING": {
      const state = await readState();
      return {
        type: "TENH_EXTENSION_PONG",
        version: VERSION,
        automaticProfileLookup: true,
        connected: Boolean(state.token),
        paired: Boolean(state.token),
        device: state.device ?? null,
      };
    }

    case "TENH_CONNECTION_STATE":
    case "TENH_PAIRING_STATE": {
      const state = await readState();
      return {
        connected: Boolean(state.token),
        paired: Boolean(state.token),
        installationId: state.installationId,
        deviceName: deviceName(),
      };
    }

    case "TENH_AUTO_CONNECTED":
    case "TENH_AUTO_PAIRED": {
      if (typeof message.token !== "string" || !message.token) {
        return { connected: false, paired: false };
      }

      await writeState({ token: message.token, device: message.device ?? null });
      await heartbeat("extension_connected");
      void flushSyncQueue();
      void deltaSync();
      void ensureRealtimeConnection({ force: true });
      void warmFacebookCompanion();
      return { connected: true, paired: true, device: message.device ?? null };
    }

    case "TENH_UNPAIR":
      return disconnect();

    case "TENH_STATUS": {
      const state = await readState();
      const tabStates = await facebookTabStates();
      const facebookPages = summarizeFacebookPages(tabStates);
      return {
        version: VERSION,
        connected: Boolean(state.token),
        paired: Boolean(state.token),
        device: state.device ?? null,
        facebook: await currentFacebookContext() ?? state.facebook ?? null,
        facebookPages,
        facebookPageCount: facebookPages.length,
        sync: {
          pending: Array.isArray(state[QUEUE_KEY]) ? state[QUEUE_KEY].length : 0,
          cursor: state.syncCursor ?? null,
          ...(state.syncStatus ?? {}),
        },
        realtime: {
          connected: realtimeSocket?.readyState === WebSocket.OPEN || tenhRealtimePorts.size > 0,
          portCount: tenhRealtimePorts.size,
          ...(state.realtimeStatus ?? {}),
        },
      };
    }

    case "OPEN_IN_FACEBOOK":
      return openFacebook({ pageId: message.pageId, threadId: message.threadId,
        conversationId: message.conversationId, businessId: message.businessId }, sender);

    case "OPEN_FACEBOOK_PROFILE":
      return openFacebookCustomerProfile(message, sender);
    case "OPEN_RESOLVED_FACEBOOK_PROFILE":
      return openResolvedFacebookProfile(message.openToken, sender, message);

    case "CHECK_FACEBOOK_REPLY_AVAILABILITY": {
      const answer = await askFacebook(
        { type: "FB_INSPECT" },
        {
          ensure: false,
          pageId: message.pageId ?? null,
          threadId: message.threadId ?? null,
        },
      );

      await heartbeat(
        answer.composerEnabled ? "composer_available" : "composer_unavailable",
      );
      return answer;
    }

    case "TENH_CONTEXT": {
      const state = await readState();
      if (!state.token) return { paired: false };

      const facebook = await currentFacebookContext();
      if (!facebook?.pageId) {
        return { paired: true, matched: false, error: "Facebook Page could not be identified safely." };
      }
      const params = new URLSearchParams();
      params.set("pageId", facebook.pageId);
      if (facebook.conversationId) params.set("threadId", facebook.conversationId);

      const { ok, status, result } = await callTenh(
        `/api/extension/context?${params.toString()}`,
        { token: state.token },
      );

      if (!ok && (status === 401 || status === 403)) {
        await clearAuth();
        return { paired: false, error: result.error };
      }
      return ok ? { paired: true, ...result } : { paired: true, error: result.error };
    }

    case "TENH_TAG": {
      const state = await readState();
      if (!state.token) return { ok: false, error: "TENH is not connected in this browser." };

      const facebook = await currentFacebookContext();
      if (!facebook?.pageId || !facebook?.conversationId) {
        return { ok: false, error: "Open the matching Facebook Page conversation before changing tags." };
      }
      const { ok, result } = await callTenh("/api/extension/tags", {
        method: "POST",
        token: state.token,
        body: {
          pageId: facebook.pageId ?? null,
          threadId: facebook.conversationId ?? null,
          tagId: message.tagId,
          action: message.action === "remove" ? "remove" : "add",
        },
      });

      if (ok) await broadcastSyncEvent({ type: "tag.changed", at: Date.now() });
      return { ok, error: ok ? null : result.error };
    }

    case "TENH_INSERT_QUICK_REPLY": {
      const state = await readState();
      const expected = await currentFacebookContext();
      if (!expected?.pageId || !expected?.conversationId) {
        return { inserted: false, reason: "page_or_conversation_unidentified" };
      }
      const found = await askFacebook(
        { type: "FB_INSPECT" },
        {
          ensure: false,
          pageId: expected.pageId ?? null,
          conversationId: expected.conversationId ?? null,
        },
      );

      if (!found?.tabId) return { inserted: false, reason: "facebook_bridge_unavailable" };
      if (!found.composerEnabled) return { inserted: false, reason: found.reason ?? "composer_unavailable" };

      try {
        const answer = await chrome.tabs.sendMessage(found.tabId, {
          type: "FB_INSERT_TEXT",
          text: String(message.text ?? ""),
        });
        return { inserted: answer?.inserted === true, reason: answer?.reason ?? null };
      } catch {
        return { inserted: false, reason: "facebook_bridge_unavailable" };
      }
    }

    case "FB_OUTGOING": {
      const state = await readState();
      if (!state.token) return { recorded: false, queued: false };

      const payload = {
        pageId: message.pageId ?? null,
        threadId: message.conversationId ?? null,
        text: String(message.text ?? ""),
        observedAt: Number(message.observedAt ?? Date.now()),
      };
      if (!payload.pageId || !payload.threadId) {
        return { recorded: false, queued: false, reason: "page_or_conversation_unidentified" };
      }
      const fingerprint = await outgoingFingerprint(payload);
      payload.fingerprint = fingerprint;

      const item = await enqueueSyncEvent("facebook.outgoing", payload, {
        dedupeKey: fingerprint,
      });
      if (item.duplicate) {
        return { recorded: true, queued: false, duplicate: true, eventId: null, fingerprint };
      }

      const flushed = await flushSyncQueue();

      return {
        recorded: flushed.pending === 0,
        queued: true,
        eventId: item.id,
        fingerprint,
      };
    }

    case "FB_ACTIVITY": {
      const state = await readState();
      if (!state.token) return { queued: false };

      const pageId = message.pageId ?? null;
      const threadId = message.conversationId ?? null;
      if (!pageId || !threadId) return { queued: false, reason: "page_or_conversation_unidentified" };

      const bucket = Math.floor(Number(message.observedAt ?? Date.now()) / 5000);
      const dedupeKey = `${pageId ?? ""}|${threadId}|${bucket}`;
      const item = await enqueueSyncEvent(
        "facebook.activity",
        {
          pageId,
          threadId,
          observedAt: Number(message.observedAt ?? Date.now()),
          reason: message.reason ?? "dom_change",
        },
        { dedupeKey },
      );
      return { queued: true, eventId: item.id };
    }

    case "TENH_WEB_SYNC_EVENT": {
      /* Optional fast path: current/future TENH web builds may push an already
         authorized realtime event into the extension. No database write here;
         extension views refresh from TENH as the source of truth. */
      if (sender?.tab?.url && !sender.tab.url.startsWith(TENH_ORIGIN)) {
        return { accepted: false };
      }
      const event = {
        type: String(message.event?.type ?? "tenh.updated").slice(0, 80),
        eventId:
          typeof message.event?.eventId === "string"
            ? message.event.eventId.slice(0, 160)
            : typeof message.event?.id === "string"
              ? message.event.id.slice(0, 160)
              : null,
        cursor: message.event?.cursor ?? null,
        at: Number(message.event?.at ?? Date.now()),
        pageId:
          typeof message.event?.pageId === "string" ? message.event.pageId.slice(0, 160) : null,
        conversationId:
          typeof message.event?.conversationId === "string"
            ? message.event.conversationId.slice(0, 200)
            : null,
        fingerprint:
          typeof message.event?.fingerprint === "string"
            ? message.event.fingerprint.slice(0, 128)
            : null,
        confirmed: message.event?.confirmed === true,
      };
      if (event.cursor) await writeState({ syncCursor: event.cursor });
      await broadcastSyncEvent(event, { toTenhTabs: false });
      return { accepted: true, ack: true, eventId: event.eventId };
    }

    case "TENH_SYNC_NOW": {
      const [queue, delta, realtime] = await Promise.all([
        flushSyncQueue(),
        deltaSync(),
        ensureRealtimeConnection(),
      ]);
      return { queue, delta, realtime };
    }

    case "TENH_REDETECT": {
      await reconnectOpenTabs();
      const tabs = await chrome.tabs.query({
        url: ["https://www.facebook.com/*", "https://business.facebook.com/*"],
      });
      const detected = [];
      for (const tab of tabs) {
        const value = await inspectFacebookTab(tab);
        if (value) detected.push(value);
      }
      const pages = summarizeFacebookPages(await facebookTabStates());
      const facebook = await currentFacebookContext() ?? detected.find((value) => value.pageId) ?? detected[0] ?? null;
      if (facebook) await writeState({ facebook });
      await heartbeat("facebook_detected");
      return {
        facebook,
        pages,
        pageCount: pages.length,
        foundTab: detected.length > 0,
      };
    }

    case "TENH_TEST": {
      const state = await readState();
      if (!state.token) return { reachable: null, connected: false, paired: false };

      try {
        const { ok, status, result } = await callTenh("/api/extension/status", {
          token: state.token,
        });
        if (!ok && (status === 401 || status === 403)) {
          await clearAuth();
          return { reachable: true, connected: false, paired: false, error: result.error };
        }
        const queue = await flushSyncQueue();
        return { reachable: true, connected: ok, paired: ok, queue, error: ok ? null : result.error };
      } catch {
        return {
          reachable: false,
          connected: true,
          paired: true,
          error: "TENH could not be reached from this browser.",
        };
      }
    }

    case "FB_STATE": {
      const facebook = {
        loggedIn: message.facebookConnected === true,
        pageId: message.pageId ?? null,
        pageName: message.pageName ?? null,
        conversationId: message.conversationId ?? null,
        url: sender?.tab?.url ?? null,
        composerState: message.composerEnabled
          ? "available"
          : message.composerFound
            ? "unavailable"
            : "unknown",
        seenAt: Date.now(),
        tabId: sender?.tab?.id ?? null,
      };
      if (Number.isInteger(sender?.tab?.id)) {
        await updateFacebookTabState(sender.tab.id, facebook);
      }
      await writeState({ facebook });
      await heartbeat(message.event ?? null);
      return { received: true, pageId: facebook.pageId, tabId: facebook.tabId };
    }

    default:
      return { ignored: true };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: String(error?.message ?? error) }));
  return true;
});

/* ---------------------------------------------------- TENH live tab bridge */

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "TENH_REALTIME_BRIDGE") return;
  const senderUrl = port.sender?.tab?.url ?? port.sender?.url ?? "";
  if (senderUrl && !senderUrl.startsWith(TENH_ORIGIN)) {
    try { port.disconnect(); } catch { /* noop */ }
    return;
  }

  tenhRealtimePorts.add(port);
  void setRealtimeStatus({
    connected: true,
    mode: realtimeSocket?.readyState === WebSocket.OPEN ? "websocket" : "tenh_tab_bridge",
    portCount: tenhRealtimePorts.size,
  });
  void deltaSync();
  void ensureRealtimeConnection();

  port.onMessage.addListener((message) => {
    if (message?.type !== "TENH_WEB_SYNC_EVENT" || !message.event) return;
    void (async () => {
      const event = {
        type: String(message.event.type ?? "tenh.updated").slice(0, 80),
        eventId:
          typeof message.event.eventId === "string"
            ? message.event.eventId.slice(0, 160)
            : typeof message.event.id === "string"
              ? message.event.id.slice(0, 160)
              : null,
        cursor: message.event.cursor ?? null,
        at: Number(message.event.at ?? Date.now()),
        pageId: typeof message.event.pageId === "string" ? message.event.pageId.slice(0, 160) : null,
        conversationId:
          typeof message.event.conversationId === "string"
            ? message.event.conversationId.slice(0, 200)
            : null,
        fingerprint:
          typeof message.event.fingerprint === "string"
            ? message.event.fingerprint.slice(0, 128)
            : null,
        confirmed: message.event.confirmed === true,
      };
      await reconcileServerEvent(event);
      await broadcastSyncEvent(event, { toTenhTabs: false });
      try {
        port.postMessage({
          type: "TENH_SYNC_ACK",
          eventId: event.eventId,
          cursor: event.cursor,
          at: Date.now(),
        });
      } catch {
        /* Port may have closed. */
      }
    })();
  });

  port.onDisconnect.addListener(() => {
    tenhRealtimePorts.delete(port);
    void setRealtimeStatus({
      connected: realtimeSocket?.readyState === WebSocket.OPEN,
      mode: realtimeSocket?.readyState === WebSocket.OPEN ? "websocket" : "delta",
      portCount: tenhRealtimePorts.size,
    });
  });
});

/* ---------------------------------------------------------------- wake-ups */

function createAlarms() {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_MINUTES });
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_MINUTES });
}

async function reconnectOpenTabs() {
  const tabs = await chrome.tabs.query({ url: [
    "https://app.tenhchat.com/*", "https://www.facebook.com/*", "https://business.facebook.com/*",
  ] });
  await Promise.allSettled(tabs.filter((tab) => tab.id).map((tab) =>
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: new URL(tab.url).hostname === "app.tenhchat.com"
        ? ["src/tenh-bridge.js"]
        : ["src/facebook-selectors.js", "src/facebook-bridge.js"],
    }),
  ));
}

chrome.runtime.onInstalled.addListener(() => {
  void reconnectOpenTabs().catch(() => {});
  void heartbeat("extension_updated");
  createAlarms();
  void chrome.action.setBadgeText({ text: "" }).catch(() => {});
  void chrome.storage.local.remove(["lastUnread", "notificationsEnabled"]);

  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }

  void readState().then(() => {
    void ensureRealtimeConnection();
    void warmFacebookCompanion();
  });
});

chrome.runtime.onStartup.addListener(() => {
  createAlarms();
  void heartbeat("extension_connected");
  void flushSyncQueue();
  void deltaSync();
  void ensureRealtimeConnection({ force: true });
  void warmFacebookCompanion();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    void heartbeat(null);
  }
  if (alarm.name === SYNC_ALARM) {
    void flushSyncQueue();
    void deltaSync();
    void ensureRealtimeConnection();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  if (/^https:\/\/(www\.|business\.)facebook\.com\//.test(changeInfo.url)) return;
  void removeFacebookTabState(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const state = await readState();
    if (state.managedFacebookTabId !== tabId) return;
    await chrome.storage.local.remove(["managedFacebookTabId", "managedFacebookWindowId"]);

    // Respect the user closing a Facebook tab; never recreate it.
  })();
});
