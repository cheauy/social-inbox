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
   * Business Suite carries the Page's own id in the URL -- normally asset_id
   * (or page_id on some surfaces) -- which is the identifier worth trusting. A display name
   * is not: two shops can share one, and TENH matches on ids.
   */
  function detectCurrentPage() {
    const url = new URL(window.location.href);

    const id =
      url.searchParams.get("asset_id") ??
      url.searchParams.get("page_id") ??
      url.searchParams.get("mailbox_id") ??
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

  function normalizeProfileText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function profileCandidateUrl(rawHref) {
    if (!rawHref) return null;

    let url;
    try {
      url = new URL(rawHref, window.location.href);
    } catch {
      return null;
    }

    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (!["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname)) {
      return null;
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";
    const lowerPath = path.toLowerCase();
    const blocked = [
      "/", "/messages", "/business", "/latest", "/settings", "/help",
      "/marketplace", "/groups", "/watch", "/reels", "/pages", "/notifications",
      "/friends", "/bookmarks", "/gaming", "/search", "/ads", "/privacy",
      "/login", "/logout", "/checkpoint", "/me", "/home", "/share", "/story",
    ];

    if (blocked.some((prefix) => lowerPath === prefix || lowerPath.startsWith(`${prefix}/`))) {
      return null;
    }

    if (lowerPath === "/profile.php") {
      const id = url.searchParams.get("id");
      if (!id || !/^\d{5,32}$/.test(id) || url.searchParams.getAll("id").length !== 1) return null;
      return `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}`;
    }

    if (/\.php$/i.test(path)) return null;

    if (/^\/people\/[^/]+\/\d{5,32}$/i.test(path)) {
      return `https://www.facebook.com${path}`;
    }

    /* Username-style profile URLs contain a single path component. This is
       deliberately strict: if Facebook does not expose a clear profile link,
       TENH returns "unavailable" instead of guessing and opening the wrong
       account. */
    if (/^\/[A-Za-z0-9._-]{2,100}$/.test(path)) {
      return `https://www.facebook.com${path}`;
    }

    return null;
  }

  function nearbyProfileText(anchor) {
    let node = anchor;
    for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
      const text = normalizeProfileText(node.textContent);
      if (text && text.length <= 700) return text;
    }
    return "";
  }

  /**
   * The customer's real profile URL, but only when Facebook itself renders a
   * link for that customer in the currently open conversation.
   *
   * The Messenger PSID is never turned into a /profile.php URL here. A link is
   * returned only when it is present in Facebook's own DOM and is tied closely
   * enough to the customer's visible name to avoid confusing one person with
   * another Page/admin profile.
   */
  function profileUrlUsesDisallowedId(profileUrl, disallowedId) {
    const blockedId = String(disallowedId ?? "").trim();
    if (!profileUrl || !blockedId) return false;

    try {
      const url = new URL(profileUrl);
      if (url.pathname.toLowerCase() === "/profile.php") {
        return url.searchParams.get("id") === blockedId;
      }

      const peopleMatch = url.pathname.match(/\/people\/[^/]+\/(\d{5,32})\/?$/i);
      return peopleMatch?.[1] === blockedId;
    } catch {
      return false;
    }
  }

  function findCustomerProfileUrls(customerName, disallowedId = null) {
    const wanted = normalizeProfileText(customerName);
    if (!wanted) return [];

    const candidates = [];

    for (const anchor of document.querySelectorAll('a[href]')) {
      const profileUrl = profileCandidateUrl(anchor.getAttribute("href"));
      if (!profileUrl || profileUrlUsesDisallowedId(profileUrl, disallowedId)) continue;

      const label = normalizeProfileText([
        anchor.textContent,
        anchor.getAttribute("aria-label"),
        anchor.getAttribute("title"),
        anchor.querySelector("img")?.getAttribute("alt"),
      ].filter(Boolean).join(" "));
      const nearby = nearbyProfileText(anchor);

      let score = 0;
      if (label === wanted) score += 36;
      else if (label.includes(wanted)) score += 22;
      if (nearby === wanted) score += 16;
      else if (nearby.includes(wanted)) score += 10;
      if (/profile\.php|\/people\//i.test(profileUrl)) score += 4;
      if (/profile|view profile/i.test(label)) score += 3;

      const rect = anchor.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) score += 2;

      if (score >= 14) {
        candidates.push({ score, url: profileUrl });
      }
    }

    const seen = new Set();
    return candidates
      .sort((a, b) => b.score - a.score)
      .filter((candidate) => {
        if (seen.has(candidate.url)) return false;
        seen.add(candidate.url);
        return true;
      })
      .slice(0, 12)
      .map((candidate) => candidate.url);
  }

  function findCustomerProfileUrl(customerName, disallowedId = null) {
    return findCustomerProfileUrls(customerName, disallowedId)[0] ?? null;
  }

  /*
   * Reveal the customer detail/profile area inside Business Suite. This does
   * not navigate to a guessed Facebook id. It only clicks the visible
   * identity control for the exact customer whose name is already shown in the
   * selected conversation, giving Facebook a chance to render its own real
   * profile link.
   */
  function clickCustomerIdentityControl(customerName) {
    const wanted = normalizeProfileText(customerName);
    if (!wanted) return false;

    let best = null;
    const controls = document.querySelectorAll(
      'a[href], button, [role="button"], [tabindex="0"]',
    );

    for (const control of controls) {
      if (selectorsSafeContainsComposer(control)) continue;

      const label = normalizeProfileText([
        control.textContent,
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        control.querySelector("img")?.getAttribute("alt"),
      ].filter(Boolean).join(" "));

      if (!label || (!label.includes(wanted) && label !== wanted)) continue;

      const rect = control.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      let score = 0;
      if (label === wanted) score += 35;
      else if (label.includes(wanted)) score += 20;

      const aria = normalizeProfileText(control.getAttribute("aria-label"));
      if (/profile|customer|contact|details/.test(aria)) score += 8;

      const href = control.getAttribute("href");
      if (href && profileCandidateUrl(href)) score += 8;

      if (rect.top >= 0 && rect.top < Math.max(650, window.innerHeight * 0.65)) {
        score += 5;
      }

      if (!best || score > best.score) best = { score, control };
    }

    if (!best || best.score < 25) return false;

    try {
      best.control.click();
      return true;
    } catch {
      return false;
    }
  }

  function selectorsSafeContainsComposer(control) {
    const composer = findMessengerComposer();
    return Boolean(composer && (control === composer || control.contains(composer)));
  }

  function isUnavailableProfilePage() {
    const bodyText = normalizeProfileText(document.body?.innerText);
    if (!bodyText) return false;

    return [
      "this content isn't available right now",
      "this content isn’t available right now",
      "this content isn't available",
      "this content isn’t available",
      "page isn't available",
      "page isn’t available",
      "content unavailable",
      "the link you followed may be broken",
    ].some((phrase) => bodyText.includes(phrase));
  }

  function validateCurrentProfilePage(expectedName = "", disallowedId = null) {
    const current = profileCandidateUrl(window.location.href);
    if (!current) return { valid: false, reason: "not_profile_route" };
    if (document.querySelector('input[type="password"]')) return { valid: false, reason: "facebook_sign_in_required" };
    if (isUnavailableProfilePage()) return { valid: false, reason: "facebook_content_unavailable" };
    const normalize = value => String(value ?? "").normalize("NFKC")
      .replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    const wanted = normalize(expectedName);
    // Facebook's global navigation/profile menu or a name in a post is not
    // evidence that this is the customer's profile. Require the visible title.
    const headings = [...document.querySelectorAll('h1, [role="heading"][aria-level="1"], main h2, [role="main"] h2')]
      .filter(el => {
        const box = el.getBoundingClientRect(), style = getComputedStyle(el);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" &&
          !el.closest('nav, [role="navigation"], [role="dialog"]');
      });
    const nameMatches = Boolean(wanted && headings.some(el => normalize(el.textContent) === wanted));
    if (!nameMatches) return { valid: false, nameMatches: false, reason: "profile_identity_unverified" };
    const target = new URL(current);
    const currentId = target.searchParams.get("id") || target.pathname.match(/\/(\d+)\/?$/)?.[1];
    if (currentId && currentId === String(disallowedId ?? "")) return { valid: false, reason: "profile_scoped_id" };
    // A numeric public ID is reported only if it already occurs in the actual
    // profile URL/canonical metadata. Never read cookies or private JS state.
    let finalUrl = current;
    if (!currentId) {
      const metadata = [...document.querySelectorAll('link[rel="canonical"], meta[property="og:url"]')]
        .map(el => profileCandidateUrl(el.getAttribute("href") || el.getAttribute("content"))).filter(Boolean);
      const unique = [...new Set(metadata)];
      if (unique.length === 1) {
        const candidate = new URL(unique[0]);
        const id = candidate.searchParams.get("id") || candidate.pathname.match(/\/(\d+)\/?$/)?.[1];
        if (id && id !== String(disallowedId ?? "")) finalUrl = unique[0];
      }
    }
    return { valid: true, nameMatches: true, reason: null, url: finalUrl };
  }

  function isMessengerSurface() {
    const { host, pathname } = window.location;

    return (
      (host === "business.facebook.com" && pathname.includes("/inbox")) ||
      (host === "www.facebook.com" && pathname.startsWith("/messages"))
    );
  }

  return {
    profileCandidateUrl,
    detectFacebookLogin,
    findMessengerComposer,
    isComposerEnabled,
    detectCurrentPage,
    detectCurrentConversation,
    detectOutgoingMessage,
    readComposerText,
    isSendControl,
    insertIntoComposer,
    findCustomerProfileUrl,
    findCustomerProfileUrls,
    clickCustomerIdentityControl,
    validateCurrentProfilePage,
    isMessengerSurface,
  };
})();

globalThis.TenhFacebookSelectors = TenhFacebookSelectors;
