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
    await setBadge(null);

    return { paired: false, error: result.error ?? "This browser was disconnected." };
  }

  if (ok && typeof result.unreadTotal === "number") {
    await setBadge(result.unreadTotal);
    await maybeNotify(result.unreadTotal, state);
  }

  return { paired: true, unreadTotal: result.unreadTotal ?? null };
}

/* --------------------------------------------------------------- badge */

/*
 * The number on the toolbar icon is TENH's own unread count, sent back with
 * each heartbeat. The extension counts nothing itself: a second unread system
 * is a second number, and the one nobody trusts is whichever is on screen.
 */
async function setBadge(total) {
  const text = total && total > 0 ? (total > 99 ? "99+" : String(total)) : "";

  try {
    await chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
    await chrome.action.setBadgeText({ text });
  } catch {
    /* No toolbar icon in this context. Not worth a word. */
  }
}

/*
 * A desktop notification, only when TENH itself could not have shown one.
 *
 * TENH already notifies while its tab is open, so notifying again here would
 * mean two alerts for one message. This fires when no TENH tab exists at all
 * -- the case the website cannot cover, because it is not running.
 */
async function maybeNotify(unreadTotal, state) {
  if (state.notificationsEnabled === false) return;

  const previous = typeof state.lastUnread === "number" ? state.lastUnread : 0;

  await writeState({ lastUnread: unreadTotal });

  if (unreadTotal <= previous || unreadTotal === 0) return;

  const tenhTabs = await chrome.tabs.query({ url: `${TENH_ORIGIN}/*` });

  if (tenhTabs.length > 0) return;

  try {
    chrome.notifications.create(`tenh-unread-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: "TENH Chat",
      message:
        unreadTotal === 1
          ? "1 unread conversation is waiting."
          : `${unreadTotal} unread conversations are waiting.`,
      silent: false,
    });
  } catch {
    /* Notifications can be off at the system level. Nothing depends on it. */
  }
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

    /*
     * What TENH knows about the thread on screen: the customer, their tags,
     * the notes, who it is assigned to, and the workspace's quick replies.
     * Every one of those rows belongs to TENH and is read from TENH. The
     * panel keeps no copy beyond the moment it is drawn.
     */
    case "TENH_CONTEXT": {
      const state = await readState();

      if (!state.token) return { paired: false };

      const facebook = state.facebook ?? {};
      const params = new URLSearchParams();

      if (facebook.pageId) params.set("pageId", facebook.pageId);
      if (facebook.conversationId) {
        params.set("threadId", facebook.conversationId);
      }

      const { ok, status, result } = await callTenh(
        `/api/extension/context?${params.toString()}`,
        { token: state.token },
      );

      if (!ok && (status === 401 || status === 403)) {
        await chrome.storage.local.remove(["token", "device"]);

        return { paired: false, error: result.error };
      }

      return ok ? { paired: true, ...result } : { paired: true, error: result.error };
    }

    /* Adds or removes a TENH tag, through TENH, with the member's own
       permissions. There is no companion tag store. */
    case "TENH_TAG": {
      const state = await readState();

      if (!state.token) return { ok: false, error: "This browser is not paired." };

      const facebook = state.facebook ?? {};

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

      return { ok, error: ok ? null : result.error };
    }

    /* Puts a TENH quick reply into Facebook's box. Insert only -- the agent
       reads it and presses Send, or does not. */
    case "TENH_INSERT_QUICK_REPLY": {
      /*
       * Asked of one tab, not broadcast. With three Facebook tabs open, a
       * broadcast would put the reply into whichever answered first, which is
       * how a message meant for one customer ends up drafted to another.
       */
      const found = await askFacebook({ type: "FB_INSPECT" });

      if (!found?.tabId) {
        return { inserted: false, reason: "no_facebook_tab" };
      }

      if (!found.composerEnabled) {
        return { inserted: false, reason: "composer_unavailable" };
      }

      try {
        const answer = await chrome.tabs.sendMessage(found.tabId, {
          type: "FB_INSERT_TEXT",
          text: String(message.text ?? ""),
        });

        return {
          inserted: answer?.inserted === true,
          reason: answer?.reason ?? null,
        };
      } catch {
        return { inserted: false, reason: "no_facebook_tab" };
      }
    }

    /*
     * A reply an agent sent from Facebook. Forwarded to TENH so it can say
     * whether Meta's webhook ever delivered it -- and nothing more. TENH does
     * not create a message from this, by design.
     */
    case "FB_OUTGOING": {
      const state = await readState();

      if (!state.token) return { recorded: false };

      const { ok, result } = await callTenh("/api/extension/observed-message", {
        method: "POST",
        token: state.token,
        body: {
          pageId: message.pageId ?? null,
          threadId: message.conversationId ?? null,
          text: message.text ?? "",
          observedAt: message.observedAt ?? Date.now(),
        },
      });

      return { recorded: ok, alreadyInTenh: result.alreadyInTenh === true };
    }

    /* ------------------------------------------------------------ repair */

    /* Ask every Facebook tab to look again, now, and report what it finds.
       The button for "it stopped noticing me". */
    case "TENH_REDETECT": {
      const answer = await askFacebook({ type: "FB_INSPECT" });

      const facebook = {
        loggedIn: answer.facebookConnected === true,
        pageId: answer.pageId ?? null,
        pageName: answer.pageName ?? null,
        conversationId: answer.conversationId ?? null,
        url: null,
        composerState: answer.composerEnabled
          ? "available"
          : answer.composerFound
            ? "unavailable"
            : "unknown",
        seenAt: Date.now(),
      };

      await writeState({ facebook });
      await heartbeat("facebook_detected");

      return { facebook, foundTab: answer.reason !== "no_facebook_tab" };
    }

    /* Does this browser still reach TENH, and does TENH still accept it. */
    case "TENH_TEST": {
      const state = await readState();

      if (!state.token) {
        return { reachable: null, paired: false };
      }

      try {
        const { ok, status, result } = await callTenh("/api/extension/status", {
          token: state.token,
        });

        if (!ok && (status === 401 || status === 403)) {
          await chrome.storage.local.remove(["token", "device"]);

          return { reachable: true, paired: false, error: result.error };
        }

        return { reachable: true, paired: ok, error: ok ? null : result.error };
      } catch {
        return {
          reachable: false,
          paired: true,
          error: "TENH could not be reached from this browser.",
        };
      }
    }

    /* Sent by the Facebook content script when what it can see changes. */
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
