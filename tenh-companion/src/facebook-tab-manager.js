/*
 * The one place that knows about Facebook tabs.
 *
 * Before this existed, two functions in the service worker each ran their own
 * chrome.tabs.query and reached their own conclusions, and the answer to "is
 * Facebook available" depended on which one you asked. Worse, both answers
 * were the same shrug -- no tab, nothing to do, tell the customer to open
 * Facebook first. Asking somebody to keep a second website open so that a
 * feature works is asking them to do the software's job.
 *
 * So this opens the tab itself, inactive, at the moment a browser-side
 * capability actually needs one, and reuses whatever is already open before it
 * considers creating anything. Three rules hold throughout:
 *
 *   One managed tab, at most. Never a second.
 *   Never steal focus, unless a person clicked something that means "take me
 *   to Facebook".
 *   Never close a tab somebody else opened.
 *
 * And the rule that outranks all of them: nothing here is required for TENH to
 * work. Every function can fail, return null, or find a browser with no
 * Facebook in it at all, and the Inbox, the webhooks and the send routes carry
 * on exactly as they do for somebody who never installed this.
 */

const INBOX_URL = "https://business.facebook.com/latest/inbox/all";

const FACEBOOK_TABS = [
  "https://www.facebook.com/*",
  "https://business.facebook.com/*",
];

/* Facebook is a slow page on a cold tab. Twenty seconds is patient enough for
   a first load on a poor connection and short enough that a caller does not
   hang on it. */
const BRIDGE_TIMEOUT_MS = 20_000;
const BRIDGE_POLL_MS = 500;

/*
 * Every ensure runs one at a time.
 *
 * A guard checked after the first await is not a guard: three callers in the
 * same tick all found "no tab", all passed the check, and all created one --
 * which the test suite caught doing exactly that. Serializing the whole
 * operation is the fix, because the second caller then finds the tab the first
 * one made. In memory only; the storage timestamp below is what survives the
 * service worker being suspended mid-flight.
 */
let queue = null;

/* If a tab was created this recently and no longer answers, something is still
   loading rather than broken. */
const CREATION_GRACE_MS = 25_000;

export function facebookInboxUrl({ pageId, threadId } = {}) {
  const url = new URL(INBOX_URL);

  if (pageId) url.searchParams.set("asset_id", pageId);

  /*
   * Business Suite selects a thread from the URL, so an "Open in Facebook"
   * can land on the actual conversation rather than the top of the list. Only
   * ever a page-scoped id from TENH's own records -- never a name.
   */
  if (threadId) url.searchParams.set("selected_item_id", threadId);

  return url.toString();
}

async function readManaged() {
  const { managedFacebookTab } = await chrome.storage.local.get(
    "managedFacebookTab",
  );

  return managedFacebookTab ?? null;
}

async function writeManaged(patch) {
  const current = (await readManaged()) ?? {};

  await chrome.storage.local.set({
    managedFacebookTab: { ...current, ...patch },
  });
}

async function clearManaged() {
  await chrome.storage.local.remove("managedFacebookTab");
}

async function tabStillExists(tabId) {
  if (typeof tabId !== "number") return null;

  try {
    const tab = await chrome.tabs.get(tabId);

    return tab && /facebook\.com/.test(tab.url ?? "") ? tab : null;
  } catch {
    /* Closed, or a tab id from before a browser restart. Both mean the same
       thing: forget it and look again. */
    return null;
  }
}

/**
 * Score a tab by how useful it is to the companion.
 *
 * Business Suite's inbox is the surface everything else is written against, so
 * it wins. A tab already on the right Page wins by more, because reusing it
 * means no navigation and no interruption.
 */
function rank(tab, pageId) {
  const url = tab.url ?? "";
  let score = 0;

  if (url.includes("business.facebook.com")) score += 4;
  if (url.includes("/inbox")) score += 3;
  if (url.includes("/messages")) score += 2;
  if (pageId && url.includes(pageId)) score += 8;

  return score;
}

/**
 * The best Facebook tab this browser already has, or null.
 *
 * Prefers the tab TENH created, then whichever open tab is closest to being
 * useful. It never touches any of them.
 */
export async function findExistingFacebookTab({ pageId } = {}) {
  const managed = await readManaged();
  const managedTab = await tabStillExists(managed?.tabId);

  if (managedTab) return { tab: managedTab, managed: true };

  if (managed) await clearManaged();

  let tabs = [];

  try {
    tabs = await chrome.tabs.query({ url: FACEBOOK_TABS });
  } catch {
    return null;
  }

  const usable = tabs.filter((tab) => typeof tab.id === "number");

  if (usable.length === 0) return null;

  usable.sort((left, right) => rank(right, pageId) - rank(left, pageId));

  return { tab: usable[0], managed: false };
}

/**
 * Is the content script in this tab answering?
 *
 * A tab can exist and still be useless -- mid-navigation, or loaded before the
 * extension was installed. When it is a tab TENH created, a reload is a fair
 * way to fix that. When somebody else opened it, it is not: reloading a page a
 * person is reading, to satisfy a background feature, is the kind of thing
 * that gets an extension uninstalled.
 */
export async function wakeFacebookBridge(tabId, { managed = false } = {}) {
  const answer = await inspect(tabId);

  if (answer) return answer;

  if (!managed) return null;

  try {
    await chrome.tabs.reload(tabId);
  } catch {
    return null;
  }

  return waitForBridge(tabId);
}

async function inspect(tabId) {
  try {
    const answer = await chrome.tabs.sendMessage(tabId, { type: "FB_INSPECT" });

    if (answer) {
      await writeManaged({ lastFacebookBridgeSeenAt: Date.now() });

      return { ...answer, tabId };
    }
  } catch {
    /* No listener yet. Loading, or not a page the manifest covers. */
  }

  return null;
}

async function waitForBridge(tabId, timeout = BRIDGE_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (!(await tabStillExists(tabId))) return null;

    const answer = await inspect(tabId);

    if (answer) return answer;

    await new Promise((resolve) => setTimeout(resolve, BRIDGE_POLL_MS));
  }

  return null;
}

/*
 * Reuse if this browser has a Facebook tab, create one quietly if it does not.
 *
 * `create` is the caller's decision, not this function's. Reporting status
 * asks with create:false, because a popup being opened is not a reason to
 * start loading Facebook. A capability that genuinely needs the page asks with
 * create:true.
 */
async function ensureFacebookTabNow({ pageId, threadId, create = true } = {}) {
  const found = await findExistingFacebookTab({ pageId });

  if (found) {
    const answer = await wakeFacebookBridge(found.tab.id, {
      managed: found.managed,
    });

    return {
      tabId: found.tab.id,
      managed: found.managed,
      created: false,
      answer,
      reason: answer ? null : "bridge_unresponsive",
    };
  }

  if (!create) {
    return { tabId: null, managed: false, created: false, answer: null, reason: "sleeping" };
  }

  const managed = await readManaged();

  if (managed?.createdAt && Date.now() - managed.createdAt < CREATION_GRACE_MS) {
    const answer = await waitForBridge(managed.tabId, CREATION_GRACE_MS);

    if (answer) {
      return {
        tabId: managed.tabId,
        managed: true,
        created: false,
        answer,
        reason: null,
      };
    }
  }

  return createManagedTab({ pageId, threadId });
}

/**
 * A Facebook tab, ready to be asked questions.
 *
 * Serialized: concurrent callers queue behind each other so the second finds
 * the tab the first created rather than opening its own.
 */
export function ensureFacebookTab(options) {
  const run = () => ensureFacebookTabNow(options);

  queue = queue ? queue.then(run, run) : run();

  return queue;
}

async function createManagedTab({ pageId, threadId }) {
  let tab;

  try {
    /*
     * Inactive, deliberately. The customer is in TENH; a feature preparing
     * itself in the background is not a reason to move them somewhere else.
     */
    tab = await chrome.tabs.create({
      url: facebookInboxUrl({ pageId, threadId }),
      active: false,
    });
  } catch {
    return {
      tabId: null,
      managed: false,
      created: false,
      answer: null,
      reason: "tab_creation_failed",
    };
  }

  await writeManaged({
    tabId: tab.id,
    createdByExtension: true,
    createdAt: Date.now(),
    pageId: pageId ?? null,
  });

  const answer = await waitForBridge(tab.id);

  return {
    tabId: tab.id,
    managed: true,
    created: true,
    answer,
    reason: answer ? null : "bridge_unresponsive",
  };
}

/** Bring a tab forward. Only ever called because a person asked. */
export async function focusFacebookTab(tabId) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });

    if (tab?.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * "Open in Facebook", from TENH or from the popup.
 *
 * The one path that is allowed to take over the screen, because somebody
 * pressed a button that says it will. Navigates an existing tab rather than
 * stacking another, and creates one only if there is nothing to navigate.
 */
export async function openFacebookInbox({
  pageId,
  threadId,
  conversationId,
  activate = true,
} = {}) {
  const target = facebookInboxUrl({ pageId, threadId });
  const found = await findExistingFacebookTab({ pageId });

  if (found) {
    try {
      await chrome.tabs.update(found.tab.id, { url: target });
    } catch {
      /* Fall through to activation: a tab that refuses a navigation is still
         better in front of somebody than nothing at all. */
    }

    const focused = activate ? await focusFacebookTab(found.tab.id) : false;

    return {
      opened: true,
      focused,
      reused: true,
      tabId: found.tab.id,
      conversationId: conversationId ?? null,
    };
  }

  try {
    const tab = await chrome.tabs.create({ url: target, active: activate });

    await writeManaged({
      tabId: tab.id,
      createdByExtension: true,
      createdAt: Date.now(),
      pageId: pageId ?? null,
    });

    return {
      opened: true,
      focused: activate,
      reused: false,
      tabId: tab.id,
      conversationId: conversationId ?? null,
    };
  } catch {
    return { opened: false, focused: false, reused: false, tabId: null };
  }
}

/**
 * What to tell a person about Facebook, in words that describe their situation
 * rather than the extension's internals.
 *
 * "sleeping" is not a failure and is not shown as one: it means no Facebook
 * page is loaded because nothing has needed one, which is the correct state
 * for a browser doing normal TENH work. "No tab" was the old answer, and it
 * read like something was broken.
 */
export async function getFacebookTabStatus({ create = false } = {}) {
  const result = await ensureFacebookTab({ create });

  if (!result.tabId) {
    return {
      state: result.reason === "tab_creation_failed" ? "error" : "sleeping",
      managed: false,
    };
  }

  if (!result.answer) {
    return {
      state: result.created ? "connecting" : "error",
      managed: result.managed,
      tabId: result.tabId,
    };
  }

  const answer = result.answer;

  if (answer.loginRequired || answer.facebookConnected === false) {
    return {
      state: "sign_in_required",
      managed: result.managed,
      tabId: result.tabId,
    };
  }

  return {
    state: "ready",
    managed: result.managed,
    tabId: result.tabId,
    pageId: answer.pageId ?? null,
    pageName: answer.pageName ?? null,
    conversationId: answer.conversationId ?? null,
    composerState: answer.composerEnabled
      ? "available"
      : answer.composerFound
        ? "unavailable"
        : "unknown",
  };
}

/**
 * Ask the best available Facebook tab a question.
 *
 * Replaces a broadcast to every Facebook tab. Broadcasting meant an answer
 * could come from a tab showing a different Page than the one asked about,
 * and an insert could land in the wrong conversation.
 */
export async function askFacebook(message, { create = true, pageId } = {}) {
  const result = await ensureFacebookTab({ pageId, create });

  if (!result.tabId) {
    return {
      facebookConnected: false,
      conversationVisible: false,
      composerFound: false,
      composerEnabled: false,
      reason: result.reason ?? "no_facebook_tab",
    };
  }

  if (message.type === "FB_INSPECT" && result.answer) return result.answer;

  try {
    const answer = await chrome.tabs.sendMessage(result.tabId, message);

    return answer ? { ...answer, tabId: result.tabId } : { reason: "no_answer" };
  } catch {
    return {
      facebookConnected: false,
      conversationVisible: false,
      composerFound: false,
      composerEnabled: false,
      reason: "bridge_unresponsive",
    };
  }
}

/**
 * Forget a managed tab that no longer exists.
 *
 * A closed tab is a decision, and on-demand mode respects it: nothing is
 * recreated here. The next capability that needs Facebook will open one, and
 * keep-active mode has its own alarm for restoring it.
 */
export async function handleTabRemoved(tabId) {
  const managed = await readManaged();

  if (managed?.tabId === tabId) await clearManaged();
}

/** The tab the customer navigated somewhere else is no longer ours to reload. */
export async function handleTabNavigated(tabId, url) {
  const managed = await readManaged();

  if (managed?.tabId !== tabId) return;
  if (/facebook\.com/.test(url ?? "")) return;

  await clearManaged();
}
