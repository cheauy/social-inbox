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
  async function readCurrent({ pageId, customerName, disallowedId }) {
    const name = normalize(customerName);
    if (!/^\d+$/.test(pageId) || !name) return { reason: "profile_context_incomplete" };
    if (!pageMatches(pageId)) return { reason: "page_mismatch_or_sign_in" };
    const input = searchBox();
    const before = location.href;
    const url = new URL(before);
    const selected = url.searchParams.get("selected_item_id");
    if (!input || !selected || url.searchParams.get("thread_type") !== "FB_MESSAGE") return { reason: "profile_link_missing" };
    const rows = matchingRows(input, name);
    if (rows.length > 1) return { reason: "ambiguous_customer" };
    if (!rows.length) return { reason: "profile_link_missing" };
    const links = profileLinks(input, name, disallowedId);
    if (links.length > 1) return { reason: "ambiguous_profile" };
    if (!links.length) return { reason: "profile_link_missing" };
    // Read only: do not focus, search, click, navigate or open Business Suite.
    await pause(350);
    const settled = profileLinks(input, name, disallowedId);
    if (location.href !== before || !pageMatches(pageId) || settled.length !== 1 || settled[0] !== links[0]) return { reason: "profile_link_missing" };
    return { profileUrl: links[0], pageId, selectedItemId: selected };
  }
  return { readCurrent, pageMatches, matchingRows, profileLinks };
})();
