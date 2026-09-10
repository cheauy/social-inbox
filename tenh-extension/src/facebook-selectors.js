/*
 * Everything that knows what Facebook's page looks like, in one file.
 *
 * Facebook's class names are generated and change without warning -- .x1lliihq
 * today, something else next Tuesday -- so nothing here reads one. What it
 * reads instead is the accessibility layer: roles, aria labels, contenteditable,
 * the things Facebook has to keep stable because screen readers depend on them.
 *
 * The day Facebook does change, this is the only file to repair. That is the
 * whole reason it exists apart from the bridge.
 */

/* eslint-disable no-var */
var TenhFacebookSelectors = (() => {
  const COMPOSER_HINTS = [
    "message",
    "reply",
    "aa", // "Aa", Messenger's own placeholder
    "សារ", // Khmer: message
  ];

  function textOf(element) {
    return (element?.getAttribute("aria-label") ?? element?.getAttribute("placeholder") ?? "")
      .trim()
      .toLowerCase();
  }

  /** Somebody is signed in when Facebook shows an account-owned control. */
  function detectFacebookLogin() {
    if (document.querySelector('[role="navigation"] [aria-label*="ccount" i]')) {
      return true;
    }

    if (document.querySelector('[aria-label*="Your profile" i]')) return true;
    if (document.querySelector('[role="banner"] [role="button"][aria-label]')) {
      return true;
    }

    /* A login form is the clearest possible "no". */
    const password = document.querySelector('input[type="password"]');

    return !password;
  }

  /**
   * The box a reply is typed into, if this page is showing one.
   *
   * Messenger and Business Suite both render it as a contenteditable textbox
   * with a label. A disabled thread has either no box at all or one that is
   * explicitly marked unavailable, which is the state TENH must respect
   * rather than work around.
   */
  function findMessengerComposer() {
    const candidates = [
      ...document.querySelectorAll(
        '[contenteditable="true"][role="textbox"], [role="textbox"][contenteditable], textarea[aria-label]',
      ),
    ];

    for (const candidate of candidates) {
      const label = textOf(candidate);

      if (!label) continue;
      if (COMPOSER_HINTS.some((hint) => label.includes(hint))) return candidate;
    }

    /* A single textbox on a Messenger screen is the composer even when its
       label is one this build has never seen. */
    return candidates.length === 1 ? candidates[0] : null;
  }

  function isComposerEnabled(composer) {
    const box = composer ?? findMessengerComposer();

    if (!box) return false;
    if (box.getAttribute("aria-disabled") === "true") return false;
    if (box.getAttribute("contenteditable") === "false") return false;
    if (box.hasAttribute("disabled")) return false;

    const style = window.getComputedStyle(box);

    if (style.display === "none" || style.visibility === "hidden") return false;

    const box2 = box.getBoundingClientRect();

    return box2.width > 0 && box2.height > 0;
  }

  /**
   * Which Page this browser is acting as.
   *
   * Business Suite carries the Page's own id in the URL -- asset_id or
   * business_id -- which is the only identifier worth trusting. A display name
   * is not: two shops can share one, and TENH matches on ids.
   */
  function detectCurrentPage() {
    const url = new URL(window.location.href);

    const id =
      url.searchParams.get("asset_id") ??
      url.searchParams.get("page_id") ??
      url.searchParams.get("business_id") ??
      null;

    const heading = document.querySelector('[role="banner"] [role="heading"]');
    const name = heading?.textContent?.trim() || null;

    return { pageId: id, pageName: name };
  }

  /**
   * The thread on screen, when Facebook says which one it is.
   *
   * Only read from the URL. Reading a name out of a heading and calling it a
   * conversation identity is how one customer's thread gets matched to
   * another's, and TENH never needs it: it opens Facebook, it does not sync
   * from it.
   */
  function detectCurrentConversation() {
    const url = new URL(window.location.href);
    const fromQuery =
      url.searchParams.get("selected_item_id") ??
      url.searchParams.get("thread_id") ??
      null;

    if (fromQuery) return fromQuery;

    const messengerThread = /\/messages\/t\/(\d+)/.exec(url.pathname);

    return messengerThread ? messengerThread[1] : null;
  }

  /*
   * The text an agent just sent, caught at the composer rather than read back
   * out of the thread.
   *
   * Parsing the message list would mean reading the whole conversation --
   * every message the customer ever wrote -- to find the one row that is new,
   * and deciding which side of the thread it sits on from layout. The composer
   * needs none of that: the text is there, it is unambiguously outgoing, it is
   * unambiguously this workspace's own, and nothing belonging to the customer
   * is ever touched.
   *
   * Returns null unless the box actually emptied, which is the difference
   * between a message sent and a stray Enter inside a draft.
   */
  function detectOutgoingMessage(snapshot) {
    const composer = findMessengerComposer();

    if (!snapshot?.text?.trim()) return null;

    const now = readComposerText(composer);

    return now === "" || now !== snapshot.text
      ? {
          text: snapshot.text,
          conversationId: snapshot.conversationId ?? detectCurrentConversation(),
          pageId: snapshot.pageId ?? detectCurrentPage().pageId,
          observedAt: snapshot.at ?? Date.now(),
        }
      : null;
  }

  function readComposerText(composer) {
    const box = composer ?? findMessengerComposer();

    if (!box) return "";

    return (box.innerText ?? box.value ?? "")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  /** Facebook's own send control, by label rather than by class. */
  function isSendControl(element) {
    const button = element?.closest?.('[role="button"], button');

    if (!button) return false;

    const label = textOf(button);

    return (
      label === "send" ||
      label.startsWith("send ") ||
      label.includes("press enter to send") ||
      label.includes("ផ្ញើ") // Khmer: send
    );
  }

  /*
   * Put a quick reply where the agent would have typed it.
   *
   * insertText, not innerText: Facebook's composer is a React-controlled
   * contenteditable, and writing to it directly leaves the framework holding a
   * different value than the box displays -- which is how a message gets sent
   * empty. This goes in as though it were typed, and stops there. Nothing here
   * presses Send; a person reads it and decides.
   */
  function insertIntoComposer(text) {
    const box = findMessengerComposer();

    if (!box || !isComposerEnabled(box) || !text) return false;

    box.focus();

    const inserted = document.execCommand("insertText", false, text);

    if (!inserted && "value" in box) {
      box.value = `${box.value ?? ""}${text}`;
      box.dispatchEvent(new Event("input", { bubbles: true }));
    }

    return true;
  }

  function isMessengerSurface() {
    const { host, pathname } = window.location;

    return (
      (host === "business.facebook.com" && pathname.includes("/inbox")) ||
      (host === "www.facebook.com" && pathname.startsWith("/messages"))
    );
  }

  return {
    detectFacebookLogin,
    findMessengerComposer,
    isComposerEnabled,
    detectCurrentPage,
    detectCurrentConversation,
    detectOutgoingMessage,
    readComposerText,
    isSendControl,
    insertIntoComposer,
    isMessengerSurface,
  };
})();

globalThis.TenhFacebookSelectors = TenhFacebookSelectors;
