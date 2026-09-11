/* Resolve profile links from Meta's UI. Never derive a public ID from a PSID. */
globalThis.TenhFacebookProfileResolver = (() => {
  const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function pageMatches(pageId) {
    const url = new URL(location.href);
    const ids = ["asset_id", "page_id", "mailbox_id"].map((key) => url.searchParams.get(key)).filter(Boolean);
    return url.origin === "https://business.facebook.com" && url.pathname.startsWith("/latest/inbox/") && ids.length > 0 && ids.every((id) => id === pageId);
  }
  function searchBox() {
    return [...document.querySelectorAll('input')].find((el) => visible(el) &&
      /search|ស្វែងរក/i.test([el.getAttribute("aria-label"), el.placeholder, el.type].join(" ")) &&
      el.getBoundingClientRect().left < innerWidth * 0.5);
  }
  function exactNames(root, name) {
    return [...root.querySelectorAll('span, strong, [dir="auto"], [role="heading"], h1, h2, h3')]
      .filter((el) => normalize(el.textContent) === name && ![...el.children].some((child) => normalize(child.textContent) === name));
  }
  function fullSearchAction(input) {
    const searchRect = input.getBoundingClientRect();
    const labels = [...document.querySelectorAll('button, [role="button"], [role="option"], a, span, [dir="auto"]')]
      .filter((el) => visible(el) && /^search in (messenger|facebook) conversations$/i.test(normalize(el.textContent)));
    for (const label of labels) {
      const action = label.closest('button, [role="button"], [role="option"], a, [tabindex="0"]') || label;
      const box = action.getBoundingClientRect();
      // Meta's deeper-search suggestion belongs below the left inbox search.
      if (box.top >= searchRect.bottom && box.top < searchRect.bottom + 240 &&
          box.left >= searchRect.left - 30 && box.right <= innerWidth * 0.6 && box.height <= 100) return action;
    }
    return null;
  }
  function matchingRows(input, name) {
    const searchRect = input.getBoundingClientRect();
    const rows = new Set();
    for (const label of exactNames(document, name)) {
      const rect = label.getBoundingClientRect();
      if (!visible(label) || rect.left > searchRect.right || rect.top < searchRect.bottom) continue;
      let row = label.closest('[role="row"], [role="option"], [role="button"], a[href], [tabindex="0"]');
      if (!row) {
        row = label;
        for (let parent = label.parentElement; parent; parent = parent.parentElement) {
          const box = parent.getBoundingClientRect();
          if (box.height > 160 || box.right > innerWidth * 0.6) break;
          if (box.width >= searchRect.width && box.height >= 35) { row = parent; break; }
        }
      }
      const box = row.getBoundingClientRect();
      if (box.height <= 160 && box.right <= innerWidth * 0.6) rows.add(row);
    }
    // Nested wrappers around the same result count once; separate rows remain ambiguous.
    return [...rows].filter((row, _, all) => !all.some((other) => other !== row && other.contains(row)));
  }
  function profileLinks(input, name, disallowedId) {
    const urls = new Set();
    for (const anchor of document.querySelectorAll('a[href]')) {
      if (!visible(anchor) || anchor.getBoundingClientRect().left <= input.getBoundingClientRect().right) continue;
      const label = normalize(anchor.textContent || anchor.getAttribute("aria-label"));
      if (!/view profile|មើលប្រវត្តិរូប/.test(label)) continue;
      const url = globalThis.TenhFacebookSelectors.profileCandidateUrl(anchor.getAttribute("href"));
      if (!url) continue;
      const parsed = new URL(url);
      const publicId = parsed.searchParams.get("id") || parsed.pathname.match(/\/(\d+)\/?$/)?.[1];
      if (publicId && publicId === disallowedId) continue;
      for (let node = anchor.parentElement, depth = 0; node && depth < 5; node = node.parentElement, depth++) {
        // Only the compact identity card, never the entire inbox or sidebar.
        if (normalize(node.textContent).length > 500 || node.getBoundingClientRect().height > 260) break;
        if (exactNames(node, name).length) { urls.add(url); break; }
      }
    }
    return [...urls];
  }
  async function resolve({ pageId, customerName, disallowedId }) {
    const name = normalize(customerName);
    if (!/^\d+$/.test(pageId) || !name) return { reason: "profile_context_incomplete" };
    const deadline = Date.now() + 30000;
    const valid = () => pageMatches(pageId) && !document.querySelector('input[type="password"]');
    let input;
    while (Date.now() < deadline && valid() && !(input = searchBox())) await pause(250);
    if (!valid()) return { reason: "page_mismatch_or_sign_in" };
    if (!input) return { reason: "search_unavailable" };
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, customerName);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await pause(1800);
    let row = null, stableAt = 0, submitted = false;
    while (Date.now() < deadline && valid()) {
      input = searchBox() || input;
      if (normalize(input.value) !== name) return { reason: "search_interrupted" };
      const searchAction = !submitted && fullSearchAction(input);
      if (searchAction) {
        searchAction.click();
        submitted = true;
        row = null;
        stableAt = 0;
        await pause(1800);
        continue;
      }
      const matches = matchingRows(input, name);
      if (matches.length > 1) return { reason: "ambiguous_customer" };
      const candidate = matches[0];
      if (candidate && candidate === row && !document.querySelector('[aria-busy="true"], [role="progressbar"]')) {
        if (Date.now() - stableAt >= 1200) break;
      } else { row = candidate ?? null; stableAt = Date.now(); }
      await pause(300);
    }
    if (!valid()) return { reason: "page_mismatch_or_sign_in" };
    if (!row || Date.now() >= deadline) return { reason: "customer_not_found" };
    const before = new URL(location.href).searchParams.get("selected_item_id");
    row.click();
    // Wait for the identity card to settle after selecting the search result.
    await pause(1200);
    let lastUrl = null, urlSince = 0;
    while (Date.now() < deadline && valid()) {
      const url = new URL(location.href);
      const selected = url.searchParams.get("selected_item_id");
      if (!selected || (url.searchParams.get("thread_type") && url.searchParams.get("thread_type") !== "FB_MESSAGE")) { await pause(250); continue; }
      const links = profileLinks(input, name, disallowedId);
      if (links.length > 1) return { reason: "ambiguous_profile" };
      if (links.length === 1) {
        if (lastUrl === links[0] && Date.now() - urlSince >= 900) return { profileUrl: links[0], pageId, selectedItemId: selected, changedSelection: selected !== before };
        if (lastUrl !== links[0]) { lastUrl = links[0]; urlSince = Date.now(); }
      } else { lastUrl = null; }
      await pause(300);
    }
    return { reason: "profile_link_unavailable" };
  }
  return { resolve, pageMatches, matchingRows, profileLinks, fullSearchAction };
})();
