/*
 * What the Facebook tab can see, reported when it changes.
 *
 * It answers four questions -- is somebody signed in, which Page is this, is a
 * thread open, is there a reply box and is it enabled -- and forwards the
 * answers to TENH, where a person decides what to do.
 *
 * Two things were added in 0.2, and both stay on the workspace's own side of
 * the conversation. It notices when an agent sends a reply from Facebook, by
 * reading the composer they typed into, so TENH can say whether that reply
 * ever arrived through Meta's webhook. And it can put a TENH quick reply into
 * that same box. It never presses Send: a person reads what was inserted and
 * decides.
 *
 * It does not read the customer's messages, and it never touches a reply box
 * Facebook has disabled. If Facebook has disabled it, that is the answer.
 */

const selectors = globalThis.TenhFacebookSelectors;

/* Enough to catch a navigation, rare enough to cost nothing. */
const SETTLE_MS = 1200;

let lastSignature = "";
let timer = null;
let observer = null;
let activityTimer = null;
let lastActivityAt = 0;
const ACTIVITY_MIN_MS = 5000;

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

function mutationTouchesComposer(mutation, composer) {
  if (!composer) return false;
  if (mutation.target === composer || composer.contains(mutation.target)) return true;

  for (const node of mutation.addedNodes ?? []) {
    if (node === composer) return true;
    if (node.nodeType === Node.ELEMENT_NODE && composer.contains(node)) return true;
  }

  return false;
}

function scheduleActivity(mutations) {
  if (!selectors.isMessengerSurface()) return;

  const conversationId = selectors.detectCurrentConversation();
  if (!conversationId) return;

  const composer = selectors.findMessengerComposer();
  const relevant = mutations.some((mutation) => {
    if (mutationTouchesComposer(mutation, composer)) return false;
    return mutation.addedNodes?.length > 0 || mutation.removedNodes?.length > 0;
  });

  if (!relevant) return;
  if (activityTimer) clearTimeout(activityTimer);

  activityTimer = setTimeout(() => {
    activityTimer = null;
    const now = Date.now();
    if (now - lastActivityAt < ACTIVITY_MIN_MS) return;

    const state = inspect();
    if (!state.facebookConnected || !state.conversationId) return;

    lastActivityAt = now;
    chrome.runtime.sendMessage(
      {
        type: "FB_ACTIVITY",
        pageId: state.pageId,
        conversationId: state.conversationId,
        observedAt: now,
        reason: "conversation_dom_changed",
      },
      () => {
        void chrome.runtime.lastError;
      },
    );
  }, SETTLE_MS);
}

function schedule(mutations = []) {
  if (timer) clearTimeout(timer);

  timer = setTimeout(() => {
    timer = null;
    report(null);
  }, SETTLE_MS);

  scheduleActivity(mutations);
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
  if (activityTimer) clearTimeout(activityTimer);

  observer = null;
  timer = null;
  activityTimer = null;
}

/* ------------------------------------------------- what the agent sent */

/*
 * A reply leaves this browser in one of two ways: Enter, or Facebook's own
 * send control. Both are watched at the capture phase so the composer can be
 * read while it still holds the text, and the send is confirmed a moment later
 * by the box having emptied.
 *
 * Nothing is intercepted or prevented. These listeners only look.
 */
function snapshotComposer() {
  const composer = selectors.findMessengerComposer();

  if (!composer) return null;

  const text = selectors.readComposerText(composer);

  if (!text) return null;

  const { pageId } = selectors.detectCurrentPage();

  return {
    text,
    pageId,
    conversationId: selectors.detectCurrentConversation(),
    at: Date.now(),
  };
}

/* Long enough for Facebook to clear the box, short enough that a second
   message is a second observation rather than a lost one. */
const SEND_CONFIRM_MS = 700;

function confirmSend(snapshot) {
  if (!snapshot) return;

  setTimeout(() => {
    const sent = selectors.detectOutgoingMessage(snapshot);

    if (!sent) return;

    chrome.runtime.sendMessage({ type: "FB_OUTGOING", ...sent }, () => {
      void chrome.runtime.lastError;
    });
  }, SEND_CONFIRM_MS);
}

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;

    const composer = selectors.findMessengerComposer();

    if (!composer || !composer.contains(event.target)) return;

    confirmSend(snapshotComposer());
  },
  true,
);

document.addEventListener(
  "click",
  (event) => {
    if (!selectors.isSendControl(event.target)) return;

    confirmSend(snapshotComposer());
  },
  true,
);

/* ------------------------------------------------------------- requests */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FB_INSPECT") {
    /* Asked directly, so answer from the page as it is now rather than from
       whatever was last reported -- a composer can close while somebody
       reads. */
    sendResponse(inspect());

    return true;
  }

  if (message?.type === "FB_FIND_CUSTOMER_PROFILE") {
    const state = inspect();
    const expectedPageId =
      typeof message.pageId === "string" ? message.pageId : null;
    const expectedConversationId =
      typeof message.conversationId === "string" ? message.conversationId : null;

    if (expectedPageId && state.pageId !== expectedPageId) {
      sendResponse({ found: false, reason: "page_mismatch" });
      return true;
    }

    if (
      expectedConversationId &&
      state.conversationId !== expectedConversationId
    ) {
      sendResponse({ found: false, reason: "conversation_mismatch" });
      return true;
    }

    const profileUrl = selectors.findCustomerProfileUrl(
      String(message.customerName ?? ""),
    );

    sendResponse({
      found: Boolean(profileUrl),
      profileUrl: profileUrl ?? null,
      reason: profileUrl ? null : "profile_link_unavailable",
    });
    return true;
  }

  if (message?.type === "FB_INSERT_TEXT") {
    const state = inspect();

    /* A disabled box is a decision Facebook has made, and inserting into it
       would be the first step of arguing with it. */
    if (!state.composerEnabled) {
      sendResponse({ inserted: false, reason: "composer_unavailable" });

      return true;
    }

    sendResponse({
      inserted: selectors.insertIntoComposer(String(message.text ?? "")),
    });

    return true;
  }

  return false;
});

report("facebook_detected");
watch();
