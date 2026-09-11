/* User-requested profile lookup. Uses only the loaded Page conversation UI.
 * Never converts a Messenger PSID into a public-profile ID or picks a customer
 * by name alone. Existing sync, sending, tags and quick replies are independent.
 */
globalThis.TenhFacebookProfileResolver = (() => {
  const version = "1.2.19";
  const normalize = value => String(value ?? "").normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => {
    const r = el.getBoundingClientRect(), style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  let lookupRunning = false;

  function pageMatches(pageId) {
    const url = new URL(location.href);
    const ids = ["asset_id", "page_id", "mailbox_id"].flatMap(key => url.searchParams.getAll(key));
    return url.origin === "https://business.facebook.com" && url.pathname.startsWith("/latest/inbox/") &&
      ids.length > 0 && ids.every(id => id === pageId);
  }
  function contextReason(options) {
    const threadId = options.threadId || options.disallowedId;
    if (!/^\d{5,32}$/.test(options.pageId || "") || !/^\d{5,32}$/.test(threadId || "") || !normalize(options.customerName)) {
      return "profile_context_incomplete";
    }
    if (document.querySelector('input[type="password"]') || /\/(login|checkpoint)([/.]|$)/.test(location.pathname)) {
      return "facebook_sign_in_required";
    }
    if (!pageMatches(options.pageId)) return "page_mismatch_or_sign_in";
    const url = new URL(location.href);
    const selected = url.searchParams.getAll("selected_item_id");
    const type = url.searchParams.get("thread_type");
    if (selected.length !== 1 || selected[0] !== threadId || (type && type !== "FB_MESSAGE")) {
      return "conversation_mismatch";
    }
    return null;
  }
  function searchBox() {
    return [...document.querySelectorAll("input")].find(el => visible(el) &&
      /search|ស្វែងរក/i.test([el.getAttribute("aria-label"), el.placeholder, el.type].join(" ")) &&
      el.getBoundingClientRect().left < innerWidth * 0.5);
  }
  function exactNames(root, name) {
    return [...root.querySelectorAll('span, strong, [dir="auto"], [role="heading"], h1, h2, h3')]
      .filter(el => visible(el) && normalize(el.textContent) === name &&
        ![...el.children].some(child => normalize(child.textContent) === name));
  }
  // Kept for diagnostics/compatibility. Lookup no longer clicks a same-name row.
  function matchingRows(input, name) {
    if (!input) return [];
    const boundary = input.getBoundingClientRect();
    return [...new Set(exactNames(document, normalize(name)).flatMap(label => {
      const r = label.getBoundingClientRect();
      const row = label.closest('[role="row"], [role="option"], [role="button"], a[href], [tabindex="0"]');
      return row && r.left <= boundary.right && r.top >= boundary.bottom ? [row] : [];
    }))];
  }
  function contentBoundary(input) {
    return input ? input.getBoundingClientRect().right : Math.min(innerWidth * 0.28, 430);
  }
  function profileLinks(input, name, disallowedId) {
    const urls = new Set();
    const wanted = normalize(name), leftBoundary = contentBoundary(input);
    for (const anchor of document.querySelectorAll('a[href]')) {
      if (!visible(anchor) || anchor.getBoundingClientRect().left <= leftBoundary ||
          anchor.closest('nav, [role="navigation"], [role="row"], [role="option"]')) continue;
      const labels = [anchor.textContent, anchor.getAttribute("aria-label"), anchor.getAttribute("title"),
        anchor.querySelector("img")?.getAttribute("alt")].map(normalize);
      if (!labels.some(label => label === wanted || /^(view (facebook )?profile|មើលប្រវត្តិរូប)$/i.test(label))) continue;
      const url = globalThis.TenhFacebookSelectors.profileCandidateUrl(anchor.getAttribute("href"));
      if (!url) continue;
      const parsed = new URL(url);
      const publicId = parsed.searchParams.get("id") || parsed.pathname.match(/\/(\d+)\/?$/)?.[1];
      if (publicId && publicId === disallowedId) continue;
      for (let node = anchor.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
        // Only the compact customer header/detail card, not a whole chat/history.
        const box = node.getBoundingClientRect();
        if (normalize(node.textContent).length > 700 || box.height > 400 ||
            node.matches('body, main, [role="main"], [role="log"], [role="feed"]')) break;
        if (exactNames(node, wanted).length) { urls.add(url); break; }
      }
    }
    return [...urls];
  }
  function snapshot(options) {
    const reason = contextReason(options);
    if (reason) return { reason };
    const threadId = options.threadId || options.disallowedId;
    const links = profileLinks(searchBox(), options.customerName, threadId);
    if (links.length > 1) return { reason: "ambiguous_profile" };
    if (!links.length) return { reason: "profile_link_missing" };
    return { profileUrl: links[0], pageId: options.pageId, selectedItemId: threadId,
      matchedThreadId: threadId, matchedBy: "page_and_thread" };
  }
  async function readCurrent(options) {
    if (lookupRunning) return { reason: "profile_lookup_busy" };
    const before = location.href, result = snapshot(options);
    if (!result.profileUrl) return result;
    await pause(400);
    const settled = snapshot(options);
    if (location.href !== before || settled.profileUrl !== result.profileUrl) {
      return { reason: settled.reason || "profile_lookup_interrupted" };
    }
    return settled;
  }
  function revealIdentityDetails(options) {
    if (contextReason(options) || document.visibilityState !== "hidden") return false;
    const name = normalize(options.customerName), boundary = contentBoundary(searchBox());
    const controls = [...document.querySelectorAll('button[aria-controls], [role="button"][aria-controls], button[aria-expanded="false"], [role="button"][aria-expanded="false"]')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return visible(el) && !el.closest('a[href], [role="row"], [role="option"]') &&
          r.left > boundary && r.top < Math.min(innerHeight * 0.5, 360) &&
          [normalize(el.textContent), normalize(el.getAttribute("aria-label"))].includes(name);
      });
    // Reveal details only. Never click an unknown View profile/send/menu action.
    if (controls.length !== 1) return false;
    controls[0].click();
    return true;
  }
  async function resolveAutomatic(options) {
    if (lookupRunning) return { reason: "profile_lookup_busy" };
    if (document.visibilityState !== "hidden") return { reason: "facebook_tab_in_use" };
    lookupRunning = true;
    try {
      const deadline = Date.now() + 10500;
      let previous = null, stableAt = 0, revealed = false;
      while (Date.now() < deadline) {
        if (document.visibilityState !== "hidden") return { reason: "facebook_tab_in_use" };
        const reason = contextReason(options);
        if (reason) return { reason };
        const result = snapshot(options);
        if (result.reason === "ambiguous_profile") return result;
        if (result.profileUrl) {
          if (result.profileUrl === previous && Date.now() - stableAt >= 800) return result;
          if (result.profileUrl !== previous) { previous = result.profileUrl; stableAt = Date.now(); }
        } else {
          previous = null;
          if (!revealed) revealed = revealIdentityDetails(options);
        }
        await pause(300);
      }
      return { reason: "profile_link_unavailable" };
    } finally { lookupRunning = false; }
  }
  return { version, readCurrent, resolveAutomatic, pageMatches, matchingRows, profileLinks };
})();
