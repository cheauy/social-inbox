/*
 * TENH v1 — the part that remembers.
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

import {
  askFacebook,
  ensureFacebookTab,
  focusFacebookTab,
  getFacebookTabStatus,
  handleTabNavigated,
  handleTabRemoved,
  openFacebookInbox,
} from "./facebook-tab-manager.js";

const TENH_ORIGIN = "https://app.tenhchat.com";
const HEARTBEAT_ALARM = "tenh-heartbeat";
const COMPANION_ALARM = "tenh-companion-active";

/* Rare on purpose. Keep-active exists so the bridge is there when something
   needs it, not so a tab is policed every minute. */
const COMPANION_MINUTES = 5;

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
    "facebookState",
    "keepCompanionActive",
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
      facebookState: state.facebookState ?? null,
      keepCompanionActive: state.keepCompanionActive === true,
      extensionVersion: VERSION,
      event: event ?? null,
    },
  });

  if (!ok && (status === 401 || status === 403)) {
    /*
     * Only a real refusal clears the pairing: revoked here, or removed from
     * the workspace. A timeout, a 500, a deploy in progress or an expired
     * subscription all leave the token alone -- dropping it on a bad minute is
     * what turns "install once" into "pair again every morning".
     *
     * Even a real refusal is not the end: the next time this browser opens
     * TENH while signed in, the content script pairs it again without asking
     * anybody for anything.
     */
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

/*
 * Remember the companion state and let the next heartbeat carry it.
 *
 * Written to storage rather than sent immediately: the service worker can be
 * suspended between a state changing and the next heartbeat, and a state kept
 * only in memory would be a status panel that goes blank for no reason the
 * customer can see.
 */
async function reportCompanionState(companion) {
  await chrome.storage.local.set({ facebookState: companion?.state ?? null });
  await heartbeat(null);
}

function deviceName() {
  const platform = navigator.userAgentData?.platform ?? "";

  return platform ? `Chrome on ${platform}` : "Chrome browser";
}

/* -------------------------------------------------------------- Facebook */

/*
 * Every Facebook tab decision now lives in facebook-tab-manager.js. What is
 * left here is the question of *when* a tab is worth having, which is a
 * product decision rather than a browser one:
 *
 *   On demand (default) -- open one at the moment a capability needs it.
 *   Keep active         -- keep one loaded while Chrome runs, so browser-side
 *                          detection and send observation are actually live.
 *
 * Neither mode is required for TENH. With no tab, no extension and no Chrome
 * at all, messages still arrive through Meta's webhook and still send through
 * the API.
 */

async function keepCompanionActive() {
  const { keepCompanionActive } = await chrome.storage.local.get(
    "keepCompanionActive",
  );

  return keepCompanionActive === true;
}

/*
 * The state TENH is told about, in the same words the popup uses.
 *
 * Read-only by default: asking for status must never be the thing that opens
 * a tab, or every heartbeat would load Facebook whether anybody needed it or
 * not. Keep-active mode is the exception, and it is the exception the customer
 * asked for by switching it on.
 */
async function companionStatus({ create = null } = {}) {
  const shouldCreate = create ?? (await keepCompanionActive());

  return getFacebookTabStatus({ create: shouldCreate });
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

    /* Asked by the content script on app.tenhchat.com, which is the only
       place that can see whether somebody is signed in. */
    case "TENH_PAIRING_STATE": {
      const state = await readState();

      return {
        paired: Boolean(state.token),
        installationId: state.installationId,
        deviceName: deviceName(),
      };
    }

    /*
     * A token the content script obtained with the person's own TENH session.
     * Stored exactly like a code-paired one -- from here on there is no
     * difference between the two, including how it is revoked.
     */
    case "TENH_AUTO_PAIRED": {
      if (typeof message.token !== "string" || !message.token) {
        return { paired: false };
      }

      await writeState({ token: message.token, device: message.device ?? null });
      await heartbeat("extension_connected");

      return { paired: true, device: message.device ?? null };
    }

    case "TENH_UNPAIR":
      return unpair();

    case "TENH_STATUS": {
      const state = await readState();

      /*
       * create:false. Opening the popup is not a companion feature, and a
       * status panel that loads Facebook every time somebody glances at it
       * would be the same imposition in a nicer wrapper -- unless keep-active
       * is on, which is a customer saying "yes, keep it loaded".
       */
      const companion = await companionStatus();

      return {
        version: VERSION,
        paired: Boolean(state.token),
        device: state.device ?? null,
        facebook: state.facebook ?? null,
        companion,
        keepCompanionActive: await keepCompanionActive(),
        notificationsEnabled: state.notificationsEnabled !== false,
      };
    }

    /*
     * Keep-active, from the popup.
     *
     * Switching it on prepares a tab immediately, because a setting that only
     * takes effect at the next Chrome restart reads as broken. Switching it
     * off leaves whatever is open alone: closing a tab somebody may be reading
     * is not this extension's business.
     */
    case "TENH_SET_KEEP_ACTIVE": {
      const enabled = message.enabled === true;

      await chrome.storage.local.set({ keepCompanionActive: enabled });

      if (enabled) {
        chrome.alarms.create(COMPANION_ALARM, {
          periodInMinutes: COMPANION_MINUTES,
        });

        const companion = await companionStatus({ create: true });

        await reportCompanionState(companion);

        return { keepCompanionActive: true, companion };
      }

      await chrome.alarms.clear(COMPANION_ALARM);

      return { keepCompanionActive: false, companion: await companionStatus() };
    }

    /*
     * Facebook wants a sign-in, and only a person can give it one.
     *
     * This brings the tab forward and stops. Nothing here reads a password,
     * fills a form, or touches a cookie -- the customer signs in to Facebook
     * exactly as they always do, and the next inspection notices.
     */
    case "TENH_SIGN_IN_FACEBOOK": {
      const prepared = await ensureFacebookTab({ create: true });

      if (!prepared.tabId) {
        return { opened: false, reason: prepared.reason ?? "unavailable" };
      }

      await focusFacebookTab(prepared.tabId);

      return { opened: true };
    }

    /* "Prepare Facebook now", from the popup's retry. */
    case "TENH_PREPARE_FACEBOOK": {
      const companion = await companionStatus({ create: true });

      await reportCompanionState(companion);

      return { companion };
    }

    case "TENH_SET_NOTIFICATIONS":
      await writeState({ notificationsEnabled: message.enabled === true });

      return { notificationsEnabled: message.enabled === true };

    /* A person pressed a button that says "take me to Facebook", so this is
       the one path allowed to move the screen. */
    case "OPEN_IN_FACEBOOK":
      return openFacebookInbox({
        pageId: message.pageId,
        threadId: message.threadId,
        conversationId: message.conversationId,
        activate: true,
      });

    /*
     * The old-conversation check, and the reason this whole tab manager
     * exists. TENH asks whether Facebook is offering a reply box; answering
     * used to require the customer to have Business Suite already open, and
     * telling somebody "open Facebook first, then ask again" is not an
     * answer. Now a tab is prepared, inactive, and the question is answered.
     */
    case "CHECK_FACEBOOK_REPLY_AVAILABILITY": {
      const answer = await askFacebook(
        {
          type: "FB_INSPECT",
          conversationId: message.conversationId ?? null,
        },
        { create: true, pageId: message.pageId ?? null },
      );

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
    /*
     * A quick reply goes into one tab, chosen by the manager -- never
     * broadcast. With three Facebook tabs open, a broadcast puts the reply
     * into whichever answers first, which is how a message meant for one
     * customer ends up drafted to another.
     *
     * A tab is created if there is none, because choosing a quick reply is a
     * person asking for one. But an insert needs the right conversation on
     * screen, and a freshly opened inbox has none: an enabled composer is the
     * condition, and where there is not one this says so.
     */
    case "TENH_INSERT_QUICK_REPLY": {
      const found = await askFacebook({ type: "FB_INSPECT" }, { create: true });

      if (!found?.tabId) {
        return { inserted: false, reason: found?.reason ?? "no_facebook_tab" };
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
        return { inserted: false, reason: "bridge_unresponsive" };
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

    /* Look again, now, and report what is found -- preparing a tab if there
       is none, because this is somebody pressing "it stopped noticing me". */
    case "TENH_REDETECT": {
      const answer = await askFacebook({ type: "FB_INSPECT" }, { create: true });

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

/*
 * Chrome starting is not a reason to open Facebook. On demand stays quiet
 * until something needs the page; only a customer who switched keep-active on
 * gets a tab prepared here, which is what they asked for.
 */
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_MINUTES });
  void heartbeat("extension_connected");

  void (async () => {
    if (!(await keepCompanionActive())) return;

    chrome.alarms.create(COMPANION_ALARM, {
      periodInMinutes: COMPANION_MINUTES,
    });

    const state = await readState();

    if (state.token) {
      await reportCompanionState(await companionStatus({ create: true }));
    }
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) void heartbeat(null);

  /*
   * Keep-active's whole job: make sure a Facebook page is loaded so the
   * bridge is there when something needs it -- including outgoing send
   * detection, which cannot see anything at all without a live document.
   */
  if (alarm.name === COMPANION_ALARM) {
    void (async () => {
      if (!(await keepCompanionActive())) {
        await chrome.alarms.clear(COMPANION_ALARM);

        return;
      }

      const state = await readState();

      /* No pairing, nothing to keep active for. */
      if (!state.token) return;

      await reportCompanionState(await companionStatus({ create: true }));
    })();
  }
});

/*
 * A managed tab that is closed, or navigated off Facebook, stops being ours.
 *
 * On demand, that is the end of it: the customer closed a tab and the
 * extension does not argue. The next capability that needs Facebook opens one.
 * Keep-active restores it at its next alarm rather than instantly, so closing
 * a tab does not turn into a fight with something that reopens it.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  void handleTabRemoved(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) void handleTabNavigated(tabId, changeInfo.url);
});

/* A notification takes somebody to TENH, which is where the work is. */
chrome.notifications?.onClicked.addListener((id) => {
  void chrome.tabs.create({ url: `${TENH_ORIGIN}/dashboard/inbox` });
  chrome.notifications.clear(id);
});
