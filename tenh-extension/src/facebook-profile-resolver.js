/* Read only the rendered customer identity in the exact Page inbox.
 * No private Facebook endpoints, cookies, access tokens or name searches.
 * The address bar alone is not proof that Facebook loaded the requested thread.
 */
globalThis.TenhFacebookProfileResolver = (() => {
  const selectors = globalThis.TenhFacebookSelectors;
  const normalize = value => String(value ?? "").normalize("NFKC")
    .replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const visible = element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
      style.visibility !== "hidden" && !element.closest('[hidden], [aria-hidden="true"]');
  };
  const excluded = 'nav, [role="navigation"], [role="feed"], [role="log"], article, [role="article"], [contenteditable="true"]';

  function context(options) {
    if (document.querySelector('input[type="password"]')) return { reason: "facebook_sign_in_required" };
    const url = new URL(window.location.href);
    if (url.origin !== "https://business.facebook.com" || !url.pathname.startsWith("/latest/inbox")) return { reason: "page_mismatch_or_sign_in" };
    const pageIds = ["asset_id", "page_id", "mailbox_id"].flatMap(key => url.searchParams.getAll(key));
    const threads = ["selected_item_id", "thread_id"].flatMap(key => url.searchParams.getAll(key));
    if (!pageIds.length || pageIds.some(id => id !== options.pageId)) return { reason: "page_mismatch_or_sign_in" };
    if (!threads.length || threads.some(id => id !== options.threadId)) return { reason: "conversation_mismatch" };
    if (url.searchParams.getAll("thread_type").some(type => type !== "FB_MESSAGE")) return { reason: "conversation_mismatch" };

    // Require Facebook's selected inbox row as independent rendered evidence.
    const selected = [...document.querySelectorAll('[aria-selected="true"], [aria-current="true"], [aria-current="page"]')].filter(visible);
    const ids = new Set();
    for (const row of selected) {
      const links = [...row.querySelectorAll('a[href]')];
      if (row.matches('a[href]')) links.push(row);
      const parentLink = row.closest('a[href]');
      if (parentLink) links.push(parentLink);
      for (const link of links) {
        try {
          const target = new URL(link.getAttribute("href"), url);
          if (target.origin !== url.origin || !target.pathname.startsWith("/latest/inbox")) continue;
          if (target.searchParams.getAll("thread_type").some(type => type !== "FB_MESSAGE")) continue;
          const pages = ["asset_id", "page_id", "mailbox_id"].flatMap(key => target.searchParams.getAll(key));
          if (pages.some(id => id !== options.pageId)) continue;
          for (const id of ["selected_item_id", "thread_id"].flatMap(key => target.searchParams.getAll(key))) ids.add(id);
        } catch { /* Not an inbox link. */ }
      }
    }
    if (ids.size !== 1 || !ids.has(options.threadId)) return { reason: "conversation_selection_unverified" };
    return { pageId: options.pageId, matchedThreadId: options.threadId, selectedItemId: options.threadId };
  }

  function identityRegions(customerName) {
    const wanted = normalize(customerName);
    if (!wanted) return [];
    const regions = new Set();
    for (const heading of document.querySelectorAll('h1, h2, h3, [role="heading"]')) {
      if (!visible(heading) || heading.closest(excluded) || normalize(heading.textContent) !== wanted) continue;
      let node = heading.parentElement;
      for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
        if (node.matches('body, main, [role="main"]') || node.closest(excluded) ||
            node.querySelector('[contenteditable], [role="log"], [role="feed"], [aria-selected]') ||
            normalize(node.textContent).length > 1500) break;
        if (node.querySelector('a[href]')) regions.add(node);
        if (node.matches('aside, [role="complementary"], [role="dialog"], header')) break;
      }
    }
    return [...regions];
  }

  function readCurrent(options = {}) {
    const match = context(options);
    if (match.reason) return match;
    const urls = new Set();
    for (const region of identityRegions(options.customerName)) {
      for (const anchor of region.querySelectorAll('a[href]')) {
        if (!visible(anchor) || anchor.closest(excluded)) continue;
        const label = normalize(anchor.textContent || anchor.getAttribute("aria-label") || anchor.getAttribute("title") || anchor.querySelector('img')?.alt);
        if (label !== normalize(options.customerName) && !/^(?:view (?:facebook )?profile|facebook profile|មើលប្រវត្តិរូប)$/.test(label)) continue;
        const url = selectors.profileCandidateUrl(anchor.getAttribute("href"));
        if (!url) continue;
        const id = new URL(url).searchParams.get("id");
        if (id === options.threadId || id === options.pageId) continue;
        urls.add(url);
      }
    }
    if (urls.size > 1) return { ...match, reason: "ambiguous_profile" };
    if (!urls.size) return { ...match, reason: "profile_link_missing" };
    return { ...match, found: true, profileUrl: [...urls][0] };
  }

  // Only the disposable background lookup tab may reveal the detail panel.
  function reveal(options = {}) {
    const match = context(options);
    if (match.reason) return match;
    if (document.visibilityState !== "hidden") return { reason: "facebook_tab_in_use" };
    const wanted = normalize(options.customerName);
    const controls = [...document.querySelectorAll('button, [role="button"]')].filter(control => {
      if (!visible(control) || control.closest(`${excluded}, a[href], [role="row"], [role="listbox"], [aria-selected]`)) return false;
      const label = normalize(control.getAttribute("aria-label") || control.textContent);
      return label === wanted && Boolean(control.querySelector('h1, h2, h3, [role="heading"]') || control.closest('header'));
    });
    if (controls.length !== 1) return { ...match, revealed: false };
    controls[0].click();
    return { ...match, revealed: true };
  }
  return { readCurrent, reveal };
})();
