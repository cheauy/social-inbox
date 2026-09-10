/*
 * TENH Companion — the part that remembers.
 *
 * The service worker holds the pairing, talks to TENH's own API, and passes
 * questions between the two content scripts. It keeps no Facebook data of its
 * own: what the Facebook script reports is forwarded and forgotten, because a
 * companion that hoards a shop's conversations is a liability nobody asked
 * for.
 *
 * Everything here is optional. If this worker never wakes, TENH behaves
 * exactly as it does for somebody who has not installed anything.
 */

const TENH_ORIGIN = "https://app.tenhchat.com";
const HEARTBEAT_ALARM = "tenh-heartbeat";

/* Half a minute is often enough to look live and rare enough to be free. */
const HEARTBEAT_MINUTES = 0.5;

const VERSION = chrome.runtime.getManifest().version;

/* ---------------------------------------------------------------- storage */

async function readState() {
  const stored = await chrome.storage.local.get([
    "token",
    "device",
    "installationId",
    "facebook",
    "notificationsEnabled",
  ]);

  if (!stored.installationId) {
    stored.installationId = crypto.randomUUID();
    await chrome.storage.local.set({ installationId: stored.installationId });
  }

  return stored;
}

async function writeState(patch) {
  await chrome.storage.local.set(patch);
}

/* ------------------------------------------------------------------ TENH */

async function callTenh(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${TENH_ORIGIN}${path}`, {
    method,
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

  return { ok: response.ok && result.success !== false, status: response.status, result };
}

/**
 * Pair this browser with the TENH account that produced the code.
 *
 * The code is all the extension is ever given: no session, no cookie, nothing
 * belonging to Facebook. What comes back is a token that can say hello, report
 * what a tab looks like, and be revoked.
 */
async function pair(code) {
  const state = await readState();

  const { ok, result } = await callTenh("/api/extension/pair", {
    method: "POST",
    body: {
      code,
      browserInstallationId: state.installationId,
      deviceName: deviceName(),
      extensionVersion: VERSION,
    },
  });

  if (!ok || !result.token) {
    return { paired: false, error: result.error ?? "Pairing failed." };
  }

  await writeState({ token: result.token, device: result.device ?? null });
  await heartbeat("extension_connected");

  return { paired: true, device: result.device ?? null };
}

async function unpair() {
  const { token } = await readState();

  if (token) {
    await callTenh("/api/extension/disconnect", { method: "POST", token }).catch(
      () => {},
    );
  }

  await chrome.storage.local.remove(["token", "device"]);

  return { paired: false };
}

/**
 * Tell TENH this browser is alive, and what its Facebook tab looks like.
 *
 * A revoked device is told so by the server refusing it; the local pairing is
 * then dropped, which is what makes "Disconnect" in TENH reach a laptop
 * somebody else is holding.
 */
async function heartbeat(event) {
  const state = await readState();

  if (!state.token) return { paired: false };

  const facebook = state.facebook ?? {};

  const { ok, status, result } = await callTenh("/api/extension/heartbeat", {
    method: "POST",
    token: state.token,
    body: {
      facebookConnected: facebook.loggedIn === true,
      pageId: facebook.pageId ?? null,
      pageName: facebook.pageName ?? null,
      url: facebook.url ?? null,
      composerState: facebook.composerState ?? "unknown",
      extensionVersion: VERSION,
      event: event ?? null,
    },
  });

  if (!ok && (status === 401 || status === 403)) {
    await chrome.storage.local.remove(["token", "device"]);

    return { paired: false, error: result.error ?? "This browser was disconnected." };
  }

  return { paired: true };
}

function deviceName() {
  const platform = navigator.userAgentData?.platform ?? "";

  return platform ? `Chrome on ${platform}` : "Chrome browser";
}

/* -------------------------------------------------------------- Facebook */

/** Ask every Facebook tab what it can see, and take the most complete answer. */
async function askFacebook(message) {
  const tabs = await chrome.tabs.query({
    url: ["https://www.facebook.com/*", "https://business.facebook.com/*"],
  });

  const answers = [];

  for (const tab of tabs) {
    if (!tab.id) continue;

    try {
      const reply = await chrome.tabs.sendMessage(tab.id, message);

      if (reply) answers.push({ ...reply, tabId: tab.id });
    } catch {
      /* A tab with no content script yet -- loading, or a page the manifest
         does not cover. Not an error worth reporting. */
    }
  }

  if (answers.length === 0) {
    return {
      facebookConnected: false,
      conversationVisible: false,
      composerFound: false,
      composerEnabled: false,
      reason: "no_facebook_tab",
    };
  }

  answers.sort((left, right) => score(right) - score(left));

  return answers[0];
}

function score(answer) {
  return (
    (answer.composerEnabled ? 8 : 0) +
    (answer.composerFound ? 4 : 0) +
    (answer.conversationVisible ? 2 : 0) +
    (answer.facebookConnected ? 1 : 0)
  );
}

/**
 * Bring the right Facebook tab forward, or open one.
 *
 * Never closes a tab and never opens a second one for a page that is already
 * there: an agent with fifteen tabs open does not need TENH adding to them.
 */
async function openFacebook({ pageId, conversationId } = {}) {
  const target = pageId
    ? `https://business.facebook.com/latest/inbox/all?asset_id=${encodeURIComponent(pageId)}`
    : "https://business.facebook.com/latest/inbox/all";

  const tabs = await chrome.tabs.query({
    url: ["https://www.facebook.com/*", "https://business.facebook.com/*"],
  });

  const existing = pageId
    ? tabs.find((tab) => (tab.url ?? "").includes(pageId))
    : tabs[0];

  if (existing?.id) {
    await chrome.tabs.update(existing.id, { active: true, url: target });
    if (existing.windowId) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }

    return { opened: true, focused: true, conversationId: conversationId ?? null };
  }

  await chrome.tabs.create({ url: target, active: true });

  return { opened: true, focused: false, conversationId: conversationId ?? null };
}

/* ------------------------------------------------------------- messaging */

/*
 * One place where every request is named. Anything not on this list is
 * ignored -- a content script is a page's neighbour, and a page is not to be
 * trusted with a switch statement that ends in "default: do it".
 */
async function handle(message, sender) {
  switch (message?.type) {
    case "TENH_EXTENSION_PING": {
      const state = await readState();

      return {
        type: "TENH_EXTENSION_PONG",
        version: VERSION,
        paired: Boolean(state.token),
        device: state.device ?? null,
      };
    }

    case "TENH_PAIR":
      return pair(String(message.code ?? ""));

    case "TENH_UNPAIR":
      return unpair();

    case "TENH_STATUS": {
      const state = await readState();

      return {
        version: VERSION,
        paired: Boolean(state.token),
        device: state.device ?? null,
        facebook: state.facebook ?? null,
        notificationsEnabled: state.notificationsEnabled !== false,
      };
    }

    case "TENH_SET_NOTIFICATIONS":
      await writeState({ notificationsEnabled: message.enabled === true });

      return { notificationsEnabled: message.enabled === true };

    case "OPEN_IN_FACEBOOK":
      return openFacebook({
        pageId: message.pageId,
        conversationId: message.conversationId,
      });

    case "CHECK_FACEBOOK_REPLY_AVAILABILITY": {
      const answer = await askFacebook({
        type: "FB_INSPECT",
        conversationId: message.conversationId ?? null,
      });

      /* Reported, not acted on. TENH decides what to say about it. */
      await heartbeat(
        answer.composerEnabled ? "composer_available" : "composer_unavailable",
      );

      return answer;
    }

    /* Sent by the Facebook content script when what it can see changes. */
    case "FB_STATE": {
      const facebook = {
        loggedIn: message.facebookConnected === true,
        pageId: message.pageId ?? null,
        pageName: message.pageName ?? null,
        url: sender?.tab?.url ?? null,
        composerState: message.composerEnabled
          ? "available"
          : message.composerFound
            ? "unavailable"
            : "unknown",
        seenAt: Date.now(),
      };

      await writeState({ facebook });
      await heartbeat(message.event ?? null);

      return { received: true };
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

/* ---------------------------------------------------------------- wake-ups */

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_MINUTES });

  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch(() => {});
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_MINUTES });
  void heartbeat("extension_connected");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) void heartbeat(null);
});

/* A notification takes somebody to TENH, which is where the work is. */
chrome.notifications?.onClicked.addListener((id) => {
  void chrome.tabs.create({ url: `${TENH_ORIGIN}/dashboard/inbox` });
  chrome.notifications.clear(id);
});
