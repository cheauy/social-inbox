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

  function profileInboxRoute(value, pageId) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port ||
          !["business.facebook.com", "www.facebook.com", "facebook.com"].includes(url.hostname)) return null;
      const pages = ["asset_id", "page_id", "mailbox_id"].flatMap(key => url.searchParams.getAll(key));
      if (pages.some(id => id !== pageId)) return null;
      const selected = ["selected_item_id", "thread_id"].flatMap(key => url.searchParams.getAll(key));
      if (selected.length && (new Set(selected).size !== 1 || !/^\d{1,32}$/.test(selected[0]))) return null;
      if (url.searchParams.getAll("thread_type").some(type => type !== "FB_MESSAGE")) return null;
      const sections = url.searchParams.getAll("section");
      if (sections.length > 1 || sections.some(section => section !== "messages")) return null;
      if (url.hostname === "business.facebook.com") {
        if (!/^\/latest\/inbox(?:\/[^/]+)?\/?$/.test(url.pathname) || !pages.length || !selected.length) return null;
        return { key: `suite:${pageId}:${selected[0]}`, selectedItemId: selected[0], url: url.href, suite: true };
      }
      const segments = url.pathname.split("/").filter(Boolean);
      const pageInbox = segments[0] === pageId && ["messages", "inbox"].includes(segments[1]) && segments.length === 2;
      const pageInboxThread = segments[0] === pageId && segments[1] === "inbox" &&
        segments.length === 3 && /^\d{1,32}$/.test(segments[2]);
      const messages = segments[0] === "messages" && (segments.length === 1 || (segments[1] === "t" && segments.length === 3));
      const legacyIds = ["threadid", "tid"].flatMap(key => url.searchParams.getAll(key));
      if (legacyIds.some(id => !/^[A-Za-z0-9_.:-]{1,200}$/.test(id))) return null;
      if (pageInboxThread && (selected.length || legacyIds.length)) return null;
      if (!(pageInboxThread || pageInbox || messages) || (!selected.length && !legacyIds.length && segments.length !== 3)) return null;
      const params = [...url.searchParams.entries()].filter(([key]) => ["selected_item_id", "thread_id", "threadid", "tid"].includes(key)).sort();
      return { key: `${segments.join("/")}:${JSON.stringify(params)}`, selectedItemId: selected[0] || null, url: url.href, suite: false };
    } catch { return null; }
  }

  function visibleError() {
    const texts = new Set([...document.querySelectorAll('h1, h2, h3, [role="heading"], [role="alert"], span, p, div')]
      .filter(el => visible(el) && !el.closest(excluded))
      .map(el => normalize(el.textContent)).filter(text => text.length > 0 && text.length <= 180));
    if (texts.has("no contact card") && [...texts].some(text => /your page can no longer see this person.s profile information/.test(text))) return "facebook_no_contact_card";
    if ([...texts].some(text => /^something went wrong\.?$/.test(text)) && [...texts].some(text => /trouble loading your experience/.test(text))) return "facebook_inbox_load_failed";
    return null;
  }

  function context(options) {
    if (document.querySelector('input[type="password"]')) return { reason: "facebook_sign_in_required" };
    if (options.linkSource !== "meta_conversations_api") return { reason: "profile_conversation_link_unavailable" };
    const expected = profileInboxRoute(options.loadedConversationLink || options.conversationLink, options.pageId);
    const actual = profileInboxRoute(window.location.href, options.pageId);
    if (!expected || !actual || expected.key !== actual.key) return { reason: "conversation_mismatch" };
    const error = visibleError();
    if (error) return { reason: error };

    // The provider-returned URL is independently bound to Page + PSID on the
    // server. If the DOM exposes a selected row, reject any conflicting row.
    const selected = [...document.querySelectorAll('[aria-selected="true"], [aria-current="true"], [aria-current="page"]')].filter(visible);
    const identities = new Set();
    for (const row of selected) {
      const links = [...row.querySelectorAll('a[href]')];
      if (row.matches('a[href]')) links.push(row);
      const parent = row.closest('a[href]'); if (parent) links.push(parent);
      for (const link of links) {
        try {
          const route = profileInboxRoute(new URL(link.getAttribute("href"), window.location.href).href, options.pageId);
          if (route) identities.add(route.key);
        } catch { /* Unrelated malformed links are not conversation evidence. */ }
      }
    }
    if (identities.size && (identities.size !== 1 || !identities.has(actual.key))) return { reason: "conversation_mismatch" };
    return { pageId: options.pageId, matchedThreadId: options.threadId, selectedItemId: actual.selectedItemId,
      conversationLink: options.conversationLink, linkSource: options.linkSource };
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
