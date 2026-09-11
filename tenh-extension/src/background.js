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

function facebookTarget({ pageId, threadId, conversationId } = {}) {
  const url = new URL(MANAGED_TAB_URL);
  const facebookThreadId = threadId ?? conversationId ?? null;
  if (pageId) url.searchParams.set("asset_id", pageId);
  if (facebookThreadId) url.searchParams.set("selected_item_id", facebookThreadId);
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

  if (managed?.id && /^https:\/\/(www\.|business\.)facebook\.com\//.test(managed.url ?? "")) {
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

async function openFacebook({ pageId, threadId, conversationId } = {}) {
  const tab = await ensureManagedFacebookTab({
    pageId,
    threadId,
    active: true,
  });
  if (!tab?.id) return { opened: false };

  return {
    opened: true,
    focused: true,
    tabId: tab.id,
    pageId: pageId ?? null,
    conversationId: conversationId ?? null,
    threadId: threadId ?? null,
    exactRequested: Boolean(threadId),
  };
}

function isSafeFacebookProfileUrl(value, disallowedId = null) {
  if (typeof value !== "string" || !value) return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname)
    ) {
      return false;
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";
    const lowerPath = path.toLowerCase();
    const profileLike =
      lowerPath === "/profile.php" ||
      /^\/people\/[^/]+\/\d{5,32}$/i.test(path) ||
      /^\/[A-Za-z0-9._-]{2,100}$/.test(path);

    if (!profileLike) return false;

    const blockedId = String(disallowedId ?? "").trim();
    if (blockedId) {
      if (
        lowerPath === "/profile.php" &&
        url.searchParams.get("id") === blockedId
      ) {
        return false;
      }

      const peopleMatch = path.match(/\/people\/[^/]+\/(\d{5,32})\/?$/i);
      if (peopleMatch?.[1] === blockedId) return false;
    }

    return true;
  } catch {
    return false;
  }
}


function canonicalFacebookProfileUrl(value) {
  if (typeof value !== "string" || !value) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" || url.username || url.password || url.port ||
      !["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname)
    ) {
      return null;
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";
    const lowerPath = path.toLowerCase();

    if (lowerPath === "/profile.php") {
      const id = url.searchParams.get("id");
      if (!id || !/^\d{5,32}$/.test(id) || url.searchParams.getAll("id").length !== 1) return null;
      return `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}`;
    }

    const peopleMatch = path.match(/^\/people\/[^/]+\/(\d{5,32})$/i);
    if (peopleMatch?.[1]) {
      return `https://www.facebook.com/profile.php?id=${encodeURIComponent(peopleMatch[1])}`;
    }

    if (/^\/[A-Za-z0-9._-]{2,100}$/.test(path) && !/\.php$/i.test(path) &&
        !/^\/(business|latest|messages|login|logout|checkpoint|settings|help|groups|pages|watch|reels|marketplace|search|friends|bookmarks|gaming|ads|privacy|notifications|home|photo|photos|posts|videos|share|story|me)$/i.test(path)) {
      if (/^\/\d+$/.test(path)) return `https://www.facebook.com/profile.php?id=${path.slice(1)}`;
      return `https://www.facebook.com${path}`;
    }

    return null;
  } catch {
    return null;
  }
}

// Profile lookup is isolated from normal sync/sending. Temporary tabs are never
// focused; only the final customer profile is activated after TENH confirms the
// same Page + conversation is still selected. A name alone is not an ID match.
const PROFILE_TICKETS_KEY = "tenhProfileOpenTicketsV2";
const PROFILE_TICKET_TTL_MS = 45000;
let profileLookupRunning = false;
let profileTicketQueue = Promise.resolve();

function trustedProfileSender(sender) {
  try {
    return Number.isInteger(sender?.tab?.id) && (sender.frameId ?? 0) === 0 &&
      new URL(sender.url || sender.tab.url).origin === TENH_ORIGIN &&
      new URL(sender.tab.url).origin === TENH_ORIGIN;
  } catch { return false; }
}

function serializeProfileTickets(task) {
  const pending = profileTicketQueue.then(task, task);
  profileTicketQueue = pending.catch(() => {});
  return pending;
}

async function withProfileTimeout(promise, milliseconds, fallback) {
  let timer;
  try {
    return await Promise.race([promise, new Promise(resolve => {
      timer = setTimeout(() => resolve(fallback), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function authorizeProfileContext(context) {
  const state = await readState();
  if (!state.token) return { ok: false, reason: "tenh_sign_in_required" };
  const params = new URLSearchParams({ pageId: context.pageId, threadId: context.threadId });
  const response = await withProfileTimeout(
    callTenh(`/api/extension/context?${params}`, { token: state.token }).catch(() => null),
    8000, null,
  );
  if (!response) return { ok: false, reason: "tenh_authorization_unavailable" };
  if ([401, 403].includes(response.status)) return { ok: false, reason: "tenh_sign_in_required" };
  const result = response.result;
  if (!response.ok || !result?.matched) return { ok: false, reason: "profile_context_unmatched" };
  if (result.page?.id !== context.pageId || result.conversation?.id !== context.conversationId ||
      result.workspace?.businessId !== context.businessId) {
    return { ok: false, reason: "profile_context_mismatch" };
  }
  // Use the name in the authorized TENH contact, never a caller-supplied substitute.
  const customerName = String(result.customer?.name || "").trim();
  if (!customerName) return { ok: false, reason: "profile_context_incomplete" };
  return { ok: true, customerName };
}

function profileInboxMatches(value, context) {
  try {
    const url = new URL(value);
    const ids = ["asset_id", "page_id", "mailbox_id"].flatMap(key => url.searchParams.getAll(key));
    const selected = url.searchParams.getAll("selected_item_id");
    const type = url.searchParams.get("thread_type");
    return url.origin === "https://business.facebook.com" && url.pathname.startsWith("/latest/inbox/") &&
      ids.length > 0 && ids.every(id => id === context.pageId) &&
      selected.length === 1 && selected[0] === context.threadId && (!type || type === "FB_MESSAGE");
  } catch { return false; }
}

async function runProfileRead(tabId, context, reveal = false) {
  try {
    // Inject only packaged, read/detection helpers. Do not reinject runtime timers.
    const options = { ...context, disallowedId: context.threadId };
    let result = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: async (options, reveal, version) => {
        const resolver = globalThis.TenhFacebookProfileResolver;
        if (resolver?.version !== version) return { reason: "profile_helpers_missing" };
        return reveal ? resolver.resolveAutomatic(options) : resolver.readCurrent(options);
      }, args: [options, reveal, VERSION],
    });
    if (result?.[0]?.result?.reason === "profile_helpers_missing") {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] },
        files: ["src/facebook-selectors.js", "src/facebook-profile-resolver.js"] });
      result = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: async (options, reveal) => reveal
          ? globalThis.TenhFacebookProfileResolver.resolveAutomatic(options)
          : globalThis.TenhFacebookProfileResolver.readCurrent(options),
        args: [options, reveal],
      });
    }
    return result?.[0]?.result || { reason: "profile_link_missing" };
  } catch { return { reason: "facebook_bridge_unavailable" }; }
}

async function waitForProfileDocument(tabId, timeout = 18000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const tab = await tabById(tabId);
    if (!tab) return { reason: "profile_tab_unavailable" };
    const url = new URL(tab.url || "about:blank");
    if (/\/(login|checkpoint|two_step_verification)([/.]|$)/i.test(url.pathname)) {
      return { reason: "facebook_sign_in_required" };
    }
    if (tab.status === "complete") return { tab };
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  return { reason: "facebook_load_timeout" };
}

function isProfileLoginUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["www.facebook.com", "facebook.com", "m.facebook.com", "business.facebook.com"].includes(url.hostname) &&
      /\/(login|checkpoint|two_step_verification)([/.]|$)/i.test(url.pathname);
  } catch { return false; }
}

async function closeOwnedProfileTab(tabId, canClose) {
  const tab = await tabById(tabId);
  // Never close a user-created tab, an activated tab or one the user navigated.
  if (tab && tab.active === false && canClose(tab.url || "")) {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function validateProfileCandidate(profileUrl, context, sender) {
  let created;
  const cleanupUrls = new Set([profileUrl]);
  try {
    created = await chrome.tabs.create({ url: profileUrl, active: false, windowId: sender.tab.windowId });
    const ready = await waitForProfileDocument(created.id, 16000);
    if (!ready.tab) return { reason: ready.reason };
    await chrome.scripting.executeScript({ target: { tabId: created.id, frameIds: [0] }, files: ["src/facebook-selectors.js"] });
    const deadline = Date.now() + 9000;
    let previous = null;
    while (Date.now() < deadline) {
      const tab = await tabById(created.id);
      if (!tab || tab.active) return { reason: "profile_lookup_interrupted" };
      const answer = await chrome.scripting.executeScript({
        target: { tabId: created.id, frameIds: [0] },
        func: (name, forbiddenId) => globalThis.TenhFacebookSelectors.validateCurrentProfilePage(name, forbiddenId),
        args: [context.customerName, context.threadId],
      });
      const validation = answer?.[0]?.result;
      if (["facebook_content_unavailable", "facebook_sign_in_required", "not_facebook", "not_profile_route"].includes(validation?.reason)) {
        return { reason: validation.reason };
      }
      const canonical = canonicalFacebookProfileUrl(validation?.url);
      if (validation?.valid && validation.nameMatches === true && canonical && isSafeFacebookProfileUrl(canonical, context.threadId)) {
        // Two settled reads avoid accepting a previous identity during navigation.
        if (previous === canonical) {
          cleanupUrls.add(canonical);
          cleanupUrls.add(canonicalFacebookProfileUrl(tab.url));
          return { profileUrl: canonical, profileId: new URL(canonical).searchParams.get("id"), verified: true };
        }
        previous = canonical;
      } else { previous = null; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return { reason: "profile_identity_unverified" };
  } catch { return { reason: "profile_validation_unavailable" }; }
  finally {
    if (created?.id) await closeOwnedProfileTab(created.id, value => {
      return cleanupUrls.has(canonicalFacebookProfileUrl(value)) || isProfileLoginUrl(value);
    });
  }
}

async function profileOpenTicket(verified, context, sender) {
  return serializeProfileTickets(async () => {
    const stored = await chrome.storage.session.get(PROFILE_TICKETS_KEY);
    const tickets = Object.fromEntries(Object.entries(stored[PROFILE_TICKETS_KEY] || {})
      .filter(([, entry]) => entry.expiresAt > Date.now()).slice(-19));
    const token = crypto.randomUUID();
    tickets[token] = { ...context, ...verified, tabId: sender.tab.id,
      documentId: sender.documentId || null, expiresAt: Date.now() + PROFILE_TICKET_TTL_MS };
    await chrome.storage.session.set({ [PROFILE_TICKETS_KEY]: tickets });
    return token;
  });
}

async function openResolvedFacebookProfile(token, sender, expected = {}) {
  if (!trustedProfileSender(sender) || typeof token !== "string") return { opened: false, reason: "profile_context_incomplete" };
  const entry = await serializeProfileTickets(async () => {
    const stored = await chrome.storage.session.get(PROFILE_TICKETS_KEY);
    const tickets = stored[PROFILE_TICKETS_KEY] || {};
    const candidate = tickets[token];
    if (!candidate || candidate.tabId !== sender.tab.id || candidate.expiresAt <= Date.now() ||
        (candidate.documentId && candidate.documentId !== sender.documentId)) return null;
    if (["businessId", "pageId", "threadId", "conversationId"].some(key => expected[key] !== candidate[key])) return null;
    delete tickets[token]; // Consume atomically before any await that can open a tab.
    await chrome.storage.session.set({ [PROFILE_TICKETS_KEY]: tickets });
    return candidate;
  });
  if (!entry) return { opened: false, reason: "profile_resolution_expired" };
  const auth = await authorizeProfileContext(entry);
  if (!auth.ok) return { opened: false, reason: auth.reason };
  if (auth.customerName !== entry.customerName) return { opened: false, reason: "profile_context_mismatch" };
  const url = canonicalFacebookProfileUrl(entry.profileUrl);
  if (!entry.verified || !url || !isSafeFacebookProfileUrl(url, entry.threadId)) return { opened: false, reason: "profile_url_unsupported" };
  try {
    const tab = await chrome.tabs.create({ url, active: true, windowId: sender.tab.windowId });
    return { opened: Boolean(tab?.id), verified: true, profileUrl: url, profileId: entry.profileId || null,
      businessId: entry.businessId, pageId: entry.pageId, threadId: entry.threadId, conversationId: entry.conversationId };
  } catch { return { opened: false, reason: "profile_tab_unavailable" }; }
}

async function openFacebookCustomerProfile(options = {}, sender) {
  const { pageId, threadId, conversationId, businessId } = options;
  if (!trustedProfileSender(sender) || !/^\d{5,32}$/.test(pageId || "") || !/^\d{5,32}$/.test(threadId || "") ||
      typeof conversationId !== "string" || !conversationId || typeof businessId !== "string" || !businessId) {
    return { opened: false, reason: "profile_context_incomplete" };
  }
  if (profileLookupRunning) return { opened: false, reason: "profile_lookup_busy" };
  profileLookupRunning = true;
  const context = { pageId, threadId, conversationId, businessId };
  try {
    const auth = await authorizeProfileContext(context);
    if (!auth.ok) return { opened: false, reason: auth.reason };
    context.customerName = auth.customerName;
    const tabs = await chrome.tabs.query({ url: ["https://business.facebook.com/latest/inbox/*"] });
    const exact = tabs.filter(tab => tab.id && !tab.discarded && profileInboxMatches(tab.url, context));
    let resolved = null;
    for (const tab of exact.slice(0, 5)) {
      const result = await runProfileRead(tab.id, context);
      if (result.reason === "ambiguous_profile") return { opened: false, reason: result.reason };
      if (result.profileUrl && result.pageId === pageId && result.matchedThreadId === threadId) { resolved = result; break; }
    }
    // Photo clicks never create or navigate a Business Suite tab. Only read
    // an already loaded exact conversation; a missing mapping is not an ID.
    if (!resolved) return { opened: false, reason: "profile_link_not_available" };
    if (!resolved?.profileUrl || resolved.pageId !== pageId || resolved.matchedThreadId !== threadId) {
      return { opened: false, reason: resolved?.reason || "profile_context_mismatch" };
    }
    const profileUrl = canonicalFacebookProfileUrl(resolved.profileUrl);
    if (!profileUrl || !isSafeFacebookProfileUrl(profileUrl, threadId)) return { opened: false, reason: "profile_url_unsupported" };
    const verified = await validateProfileCandidate(profileUrl, context, sender);
    if (!verified.verified) return { opened: false, reason: verified.reason };
    return { opened: false, resolved: true, ...context, ...verified,
      selectedItemId: resolved.selectedItemId, openToken: await profileOpenTicket(verified, context, sender) };
  } catch { return { opened: false, reason: "profile_resolution_unavailable" }; }
  finally {
    profileLookupRunning = false;
  }
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
      return openFacebook({
        pageId: message.pageId,
        threadId: message.threadId,
        conversationId: message.conversationId,
      });

    case "OPEN_FACEBOOK_PROFILE":
      return openFacebookCustomerProfile({
        pageId: message.pageId,
        threadId: message.threadId,
        conversationId: message.conversationId,
        customerName: message.customerName,
        businessId: message.businessId,
      }, sender);

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
        : ["src/facebook-selectors.js", "src/facebook-profile-resolver.js", "src/facebook-bridge.js"],
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
