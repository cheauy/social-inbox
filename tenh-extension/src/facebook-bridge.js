/*
 * What the Facebook tab can see, reported when it changes.
 *
 * Version 0.1 reads and reports. It does not type, click, send, or read a
 * conversation's contents: it answers four questions -- is somebody signed in,
 * which Page is this, is a thread open, is there a reply box and is it enabled
 * -- and forwards the answers to TENH, where a person decides what to do.
 *
 * If Facebook has disabled the reply box, that is the answer. Nothing here
 * looks for a way around it.
 */

const selectors = globalThis.TenhFacebookSelectors;

/* Enough to catch a navigation, rare enough to cost nothing. */
const SETTLE_MS = 1200;

let lastSignature = "";
let timer = null;
let observer = null;

function inspect() {
  const loggedIn = selectors.detectFacebookLogin();
  const { pageId, pageName } = selectors.detectCurrentPage();
  const conversationId = selectors.detectCurrentConversation();
  const composer = selectors.findMessengerComposer();

  return {
    facebookConnected: loggedIn,
    pageId,
    pageName,
    conversationId,
    conversationVisible: Boolean(conversationId) || selectors.isMessengerSurface(),
    composerFound: Boolean(composer),
    composerEnabled: composer ? selectors.isComposerEnabled(composer) : false,
  };
}

/*
 * Only a change is worth a message. Facebook rewrites parts of its page
 * constantly -- a badge counter, a typing dot -- and forwarding all of that
 * would be a heartbeat every second for no information at all.
 */
function report(event) {
  const state = inspect();
  const signature = [
    state.facebookConnected,
    state.pageId,
    state.conversationId,
    state.composerFound,
    state.composerEnabled,
  ].join("|");

  if (!event && signature === lastSignature) return;

  lastSignature = signature;

  chrome.runtime.sendMessage({ type: "FB_STATE", ...state, event }, () => {
    /* The worker may be asleep or the extension mid-reload. Nothing here
       depends on the reply, and a failure must never reach Facebook's page. */
    void chrome.runtime.lastError;
  });
}

function schedule() {
  if (timer) clearTimeout(timer);

  timer = setTimeout(() => {
    timer = null;
    report(null);
  }, SETTLE_MS);
}

/*
 * One observer, on the document, watching only for structural change --
 * attributes and text are what Facebook churns, and subscribing to them is
 * how an extension turns a laptop fan on.
 */
function watch() {
  observer = new MutationObserver(schedule);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
  });

  window.addEventListener("pagehide", stop, { once: true });
}

function stop() {
  if (observer) observer.disconnect();
  if (timer) clearTimeout(timer);

  observer = null;
  timer = null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "FB_INSPECT") return false;

  /* Asked directly, so answer from the page as it is now rather than from
     whatever was last reported -- a composer can close while somebody reads. */
  sendResponse(inspect());

  return true;
});

report("facebook_detected");
watch();
